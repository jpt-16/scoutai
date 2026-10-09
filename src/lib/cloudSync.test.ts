import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CloudSyncEngine,
  decideSync,
  decodeBody,
  encodeBody,
  hasContent,
  isValidRemote,
} from "./cloudSync";
import { DEMO_FILE_NAME } from "./demoScript";
import { LOCAL_KEYS, readMeta, setSlotMeta } from "./syncMeta";

describe("decideSync", () => {
  const remote = { etag: "v2" };

  it("pushes what this device has when the staff has nothing yet", () => {
    expect(decideSync({ hasLocal: true, dirty: false, base: null, remote: null })).toBe("push");
    expect(decideSync({ hasLocal: false, dirty: false, base: null, remote: null })).toBe("idle");
  });

  it("pulls onto a device with nothing of its own", () => {
    expect(decideSync({ hasLocal: false, dirty: false, base: null, remote })).toBe("pull");
  });

  it("pushes this device's edits when nobody else saved in between", () => {
    expect(decideSync({ hasLocal: true, dirty: true, base: "v2", remote })).toBe("push");
    expect(decideSync({ hasLocal: true, dirty: false, base: "v2", remote })).toBe("idle");
  });

  it("pulls what another coach saved when this device has no edits", () => {
    expect(decideSync({ hasLocal: true, dirty: false, base: "v1", remote })).toBe("pull");
  });

  it("asks, never overwrites, when both changed or a device with its own copy first signs in", () => {
    expect(decideSync({ hasLocal: true, dirty: true, base: "v1", remote })).toBe("conflict");
    expect(decideSync({ hasLocal: true, dirty: false, base: null, remote })).toBe("conflict");
    expect(decideSync({ hasLocal: true, dirty: true, base: null, remote })).toBe("conflict");
  });
});

describe("what's worth sharing", () => {
  it("skips an empty script, the public demo and an empty playsheet", () => {
    expect(hasContent("script", JSON.stringify({ cards: [], films: ["a.csv"] }))).toBe(false);
    expect(hasContent("script", JSON.stringify({ cards: [{}], films: [DEMO_FILE_NAME] }))).toBe(false);
    expect(hasContent("script", JSON.stringify({ cards: [{}], films: ["a.csv"] }))).toBe(true);
    expect(hasContent("practice", JSON.stringify({ days: [{ periods: [{ text: "  " }] }] }))).toBe(false);
    expect(hasContent("practice", JSON.stringify({ days: [{ periods: [{ text: "TRIPS RT 836" }] }] }))).toBe(true);
    expect(hasContent("script", "not json")).toBe(false);
  });

  it("only applies a download with the shape the app reads", () => {
    expect(isValidRemote("script", JSON.stringify({ cards: [] }))).toBe(true);
    expect(isValidRemote("playbook", JSON.stringify({ days: [] }))).toBe(false);
    expect(isValidRemote("practice", JSON.stringify({ days: [] }))).toBe(true);
    expect(isValidRemote("script", "{")).toBe(false);
  });
});

describe("the body on the wire", () => {
  it("round-trips through gzip, and is smaller", async () => {
    const json = JSON.stringify({ cards: Array.from({ length: 200 }, (_, i) => ({ id: i, formation: "TRIPS RT" })) });
    const { body, contentType } = await encodeBody(json);
    expect(contentType).toBe("application/gzip");
    expect(body.byteLength).toBeLessThan(json.length / 4);
    const copy = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    expect(await decodeBody(copy, contentType)).toBe(json);
  });
});

/* ---------------------------- the engine, end to end ---------------------------- */

/** An in-memory stand-in for /api/sync with the same version rules as the real store. */
class FakeServer {
  slots = new Map<string, { etag: string; body: Uint8Array; contentType: string; updatedAt: string }>();
  n = 0;
  deny = false;
  calls: string[] = [];

  async handle(url: string, init?: RequestInit): Promise<Response> {
    const u = new URL(url, "http://x");
    const slot = u.searchParams.get("slot")!;
    this.calls.push(`${init?.method ?? "GET"} ${slot}`);
    if (this.deny) return new Response("{}", { status: 403 });
    const have = this.slots.get(slot);
    if (!init?.method || init.method === "GET") {
      if (!have) return new Response(null, { status: 204 });
      if (u.searchParams.get("etag") === have.etag) return new Response(null, { status: 304 });
      return new Response(have.body as BodyInit, {
        headers: { "content-type": have.contentType, "x-sync-etag": have.etag, "x-sync-updated": have.updatedAt },
      });
    }
    const base = u.searchParams.get("base");
    if ((have?.etag ?? null) !== (base || null)) return new Response("{}", { status: 409 });
    const etag = `e${++this.n}`;
    const body = new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
    this.slots.set(slot, { etag, body, contentType: String((init.headers as Record<string, string>)["content-type"]), updatedAt: new Date().toISOString() });
    return Response.json({ etag });
  }

  /** Another coach saves. */
  async save(slot: string, json: string) {
    const { body, contentType } = await encodeBody(json);
    const etag = `e${++this.n}`;
    this.slots.set(slot, { etag, body, contentType, updatedAt: new Date().toISOString() });
    return etag;
  }
  async read(slot: string) {
    const have = this.slots.get(slot)!;
    const copy = have.body.buffer.slice(have.body.byteOffset, have.body.byteOffset + have.body.byteLength) as ArrayBuffer;
    return decodeBody(copy, have.contentType);
  }
}

const script = (name: string, plays: number) =>
  JSON.stringify({ fileName: name, films: [name], savedAt: "", cards: Array.from({ length: plays }, (_, i) => ({ id: `${i}` })), warnings: [] });

describe("CloudSyncEngine", () => {
  let server: FakeServer;
  let engine: CloudSyncEngine;
  let store: Map<string, string>;
  let applied: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    server = new FakeServer();
    store = new Map();
    applied = [];
    const listeners = new Map<string, Set<(e: Event) => void>>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
      addEventListener: (t: string, fn: (e: Event) => void) => {
        if (!listeners.has(t)) listeners.set(t, new Set());
        listeners.get(t)!.add(fn);
      },
      removeEventListener: (t: string, fn: (e: Event) => void) => void listeners.get(t)?.delete(fn),
      dispatchEvent: (e: Event) => {
        if (e.type === "scoutcard:remote-applied") applied.push((e as CustomEvent).detail.slot);
        listeners.get(e.type)?.forEach((fn) => fn(e));
        return true;
      },
    });
    vi.stubGlobal("document", { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" });
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => server.handle(url, init));
    engine = new CloudSyncEngine();
  });
  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const local = (slot: "script" | "playbook" | "practice") => store.get(LOCAL_KEYS[slot]);

  it("a new device signs in and gets the staff's script", async () => {
    await server.save("script", script("week-5.csv", 12));
    engine.start("org_1");
    await engine.syncAll();
    expect(JSON.parse(local("script")!).cards).toHaveLength(12);
    expect(applied).toContain("script");
    expect(readMeta().script).toMatchObject({ dirty: false });
    expect(engine.getState().status).toBe("synced");
  });

  it("uploads what this device has when the staff has nothing, then only when it changes", async () => {
    store.set(LOCAL_KEYS.playbook, script("our-book.csv", 30));
    engine.start("org_1");
    await engine.syncAll();
    expect(JSON.parse(await server.read("playbook")).cards).toHaveLength(30);
    server.calls.length = 0;
    await engine.syncAll();
    expect(server.calls).not.toContain("PUT playbook"); // nothing new to send

    store.set(LOCAL_KEYS.playbook, script("our-book.csv", 31));
    setSlotMeta("playbook", { dirty: true });
    await engine.syncAll();
    expect(JSON.parse(await server.read("playbook")).cards).toHaveLength(31);
  });

  it("takes what another coach saved when this device has no edits", async () => {
    store.set(LOCAL_KEYS.script, script("week-5.csv", 5));
    engine.start("org_1");
    await engine.syncAll(); // pushes, now in step
    await server.save("script", script("week-5.csv", 9)); // the other coach
    await engine.syncAll();
    expect(JSON.parse(local("script")!).cards).toHaveLength(9);
  });

  it("asks when both this device and the staff changed, and keeps the coach's choice", async () => {
    store.set(LOCAL_KEYS.script, script("week-5.csv", 5));
    engine.start("org_1");
    await engine.syncAll();
    await server.save("script", script("week-5.csv", 9)); // the other coach
    store.set(LOCAL_KEYS.script, script("week-5.csv", 6)); // and this one
    setSlotMeta("script", { dirty: true });
    await engine.syncAll();
    expect(engine.getState().status).toBe("conflict");
    expect(engine.getState().conflicts.map((c) => c.slot)).toEqual(["script"]);
    expect(JSON.parse(local("script")!).cards).toHaveLength(6); // nothing overwritten yet

    await engine.resolve("script", "staff");
    expect(JSON.parse(local("script")!).cards).toHaveLength(9);
    expect(engine.getState().conflicts).toEqual([]);
  });

  it("keeping this device's version replaces the staff's", async () => {
    await server.save("script", script("theirs.csv", 9));
    store.set(LOCAL_KEYS.script, script("mine.csv", 4)); // first sign-in with its own copy
    engine.start("org_1");
    await engine.syncAll();
    expect(engine.getState().conflicts).toHaveLength(1);
    await engine.resolve("script", "mine");
    expect(JSON.parse(await server.read("script")).cards).toHaveLength(4);
    expect(engine.getState().conflicts).toEqual([]);
  });

  it("stops quietly when there's no access (preview, no team, not subscribed)", async () => {
    server.deny = true;
    engine.start("org_1");
    await engine.syncAll();
    expect(engine.getState().status).toBe("off");
  });

  it("a different team starts the device's sync history fresh", async () => {
    store.set(LOCAL_KEYS.script, script("a.csv", 3));
    engine.start("org_1");
    await engine.syncAll();
    engine.stop();
    expect(readMeta().script?.etag).toBeTruthy();
    engine.start("org_2");
    expect(readMeta().script).toBeUndefined();
  });
});

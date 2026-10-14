import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGameChanges, markGameChanged, pendingGameSave, saveGameNow } from "./gameSave";
import { loadScript, storeScript, type StoredScript } from "./scriptStore";

/** A game's cards sent back to the staff's copy of that game (PUT /api/film/jobs/<id>/game). */
describe("sending a game's cards back to the library", () => {
  let store: Map<string, string>;
  let puts: { url: string; body: unknown }[];
  let online: boolean;

  beforeEach(() => {
    store = new Map();
    puts = [];
    online = true;
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
      dispatchEvent: () => true,
    });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (!online) throw new TypeError("offline");
      const raw = new Uint8Array(await new Response(init!.body).arrayBuffer());
      const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString() : new TextDecoder().decode(raw);
      puts.push({ url, body: JSON.parse(text) });
      return new Response(JSON.stringify({ job: {} }), { status: 200 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const script = (gameId?: string): StoredScript =>
    storeScript({ fileName: "g", films: ["g"], savedAt: "", cards: [], warnings: [], ...(gameId ? { gameId, gameName: "vs Central" } : {}) });

  it("sends the open game's script to that game, and then has nothing waiting", async () => {
    script("abc");
    markGameChanged("abc");
    expect(await saveGameNow()).toBe(true);
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe("/api/film/jobs/abc/game");
    expect(puts[0].body).toMatchObject({ gameId: "abc", gameName: "vs Central" });
    expect(pendingGameSave()).toBeNull();
    expect(loadScript()?.gameId).toBe("abc");
  });

  it("keeps the changes waiting when it can't reach the app, and sends them later", async () => {
    script("abc");
    markGameChanged("abc");
    online = false;
    expect(await saveGameNow()).toBe(false);
    expect(pendingGameSave()).toBe("abc");
    online = true;
    expect(await saveGameNow()).toBe(true);
    expect(puts).toHaveLength(1);
    expect(pendingGameSave()).toBeNull();
  });

  it("sends nothing when nothing changed, or when the script on the device is no longer that game", async () => {
    script("abc");
    expect(await saveGameNow()).toBe(true);
    markGameChanged("abc");
    script("other");
    expect(await saveGameNow()).toBe(true);
    clearGameChanges();
    expect(puts).toHaveLength(0);
  });
});

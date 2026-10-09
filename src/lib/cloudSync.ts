/**
 * Keeps this device's script, playbook and playsheet in step with the staff's
 * shared copy (`/api/sync`), so a coach who signs in on a new iPad, or a second
 * coach on the same team, sees the same thing. The device copy stays the one the
 * app reads and writes (so it works with no signal on the field); this only moves
 * it up and down.
 *
 * The rule (`decideSync`) is deliberately cautious: it never overwrites work it
 * hasn't seen. If this device has edits and the staff's copy changed too, or this
 * device has its own copy and has never synced, the coach picks which to keep.
 */

import { DEMO_FILE_NAME } from "./demoScript";
import {
  CHANGED_EVENT,
  LOCAL_KEYS,
  REMOTE_APPLIED_EVENT,
  SYNC_SLOTS,
  readMeta,
  setSlotMeta,
  writeMeta,
  type SyncSlot,
} from "./syncMeta";

/* -------------------------------------------------------------------------- */
/*                                  The rule                                  */
/* -------------------------------------------------------------------------- */

export type Decision = "idle" | "push" | "pull" | "conflict";

export function decideSync(input: {
  /** This device has something worth sharing (not empty, not the public demo). */
  hasLocal: boolean;
  /** Edited here since the last sync. */
  dirty: boolean;
  /** The staff's copy this device last matched, or null if never. */
  base: string | null;
  /** The staff's copy now, or null if nothing is saved yet. */
  remote: { etag: string } | null;
}): Decision {
  const { hasLocal, dirty, base, remote } = input;
  if (!remote) return hasLocal ? "push" : "idle";
  if (base === remote.etag) return dirty && hasLocal ? "push" : "idle";
  // The staff's copy is not the one this device last saw.
  if (!hasLocal) return "pull";
  if (!dirty && base !== null) return "pull";
  return "conflict";
}

/* -------------------------------------------------------------------------- */
/*                               Bodies and wire                              */
/* -------------------------------------------------------------------------- */

export async function encodeBody(json: string): Promise<{ body: Uint8Array; contentType: string }> {
  const plain = new TextEncoder().encode(json);
  if (typeof CompressionStream === "undefined") return { body: plain, contentType: "application/json" };
  const stream = new Blob([plain as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return { body: new Uint8Array(await new Response(stream).arrayBuffer()), contentType: "application/gzip" };
}

export async function decodeBody(body: ArrayBuffer, contentType: string): Promise<string> {
  if (!contentType.includes("gzip")) return new TextDecoder().decode(body);
  const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export type PullResult =
  | { kind: "none" }
  | { kind: "unchanged" }
  | { kind: "data"; etag: string; updatedAt: string; json: string }
  | { kind: "denied" }
  | { kind: "error" };

export async function pullSlot(slot: SyncSlot, etag: string | null): Promise<PullResult> {
  const query = new URLSearchParams({ slot });
  if (etag) query.set("etag", etag);
  let res: Response;
  try {
    res = await fetch(`/api/sync?${query}`, { cache: "no-store" });
  } catch {
    return { kind: "error" };
  }
  if (res.status === 204) return { kind: "none" };
  if (res.status === 304) return { kind: "unchanged" };
  if ([401, 402, 403, 404, 501].includes(res.status)) return { kind: "denied" };
  if (!res.ok) return { kind: "error" };
  try {
    const json = await decodeBody(await res.arrayBuffer(), res.headers.get("content-type") ?? "");
    return {
      kind: "data",
      etag: res.headers.get("x-sync-etag") ?? "",
      updatedAt: res.headers.get("x-sync-updated") ?? "",
      json,
    };
  } catch {
    return { kind: "error" };
  }
}

export type PushResult =
  | { kind: "ok"; etag: string }
  | { kind: "conflict" }
  | { kind: "too_big" }
  | { kind: "denied" }
  | { kind: "error" };

export async function pushSlot(slot: SyncSlot, json: string, base: string | null): Promise<PushResult> {
  const query = new URLSearchParams({ slot });
  if (base) query.set("base", base);
  let res: Response;
  try {
    const { body, contentType } = await encodeBody(json);
    res = await fetch(`/api/sync?${query}`, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: body as BodyInit,
    });
  } catch {
    return { kind: "error" };
  }
  if (res.status === 409) return { kind: "conflict" };
  if (res.status === 413) return { kind: "too_big" };
  if ([401, 402, 403, 404, 501].includes(res.status)) return { kind: "denied" };
  if (!res.ok) return { kind: "error" };
  const { etag } = (await res.json().catch(() => ({}))) as { etag?: string };
  return etag ? { kind: "ok", etag } : { kind: "error" };
}

/* -------------------------------------------------------------------------- */
/*                               This device's copy                           */
/* -------------------------------------------------------------------------- */

/** Whether a saved copy is worth sharing: it has something in it, and isn't the public demo. */
export function hasContent(slot: SyncSlot, json: string): boolean {
  try {
    const data = JSON.parse(json) as {
      cards?: unknown[];
      films?: string[];
      days?: { periods?: { text?: string }[] }[];
    };
    if (slot === "practice") {
      return Boolean(data.days?.some((d) => d.periods?.some((p) => (p.text ?? "").trim())));
    }
    if (!Array.isArray(data.cards) || data.cards.length === 0) return false;
    return !(data.films?.length === 1 && data.films[0] === DEMO_FILE_NAME);
  } catch {
    return false;
  }
}

/** A downloaded copy is only applied if it has the shape the app reads. */
export function isValidRemote(slot: SyncSlot, json: string): boolean {
  try {
    const data = JSON.parse(json) as { cards?: unknown; days?: unknown };
    return slot === "practice" ? Array.isArray(data.days) : Array.isArray(data.cards);
  } catch {
    return false;
  }
}

function readLocal(slot: SyncSlot): { json: string | null; has: boolean } {
  try {
    const json = window.localStorage.getItem(LOCAL_KEYS[slot]);
    return { json, has: json != null && hasContent(slot, json) };
  } catch {
    return { json: null, has: false };
  }
}

/* -------------------------------------------------------------------------- */
/*                                   Engine                                   */
/* -------------------------------------------------------------------------- */

export type SyncStatus = "off" | "idle" | "syncing" | "synced" | "offline" | "conflict" | "error";

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  /** Slots where this device and the staff's copy both changed: the coach decides. */
  conflicts: { slot: SyncSlot; updatedAt: string }[];
  message: string;
}

const OWNER_KEY = "scoutcard:sync-owner:v1";
const PUSH_DELAY_MS = 2500;
const POLL_MS = 60_000;

export class CloudSyncEngine {
  private state: SyncState = { status: "off", lastSyncedAt: null, conflicts: [], message: "" };
  private listeners = new Set<() => void>();
  private started = false;
  private chain: Promise<void> = Promise.resolve();
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  /** The staff's copy downloaded when it conflicted, so "use theirs" needs no second trip. */
  private pending = new Map<SyncSlot, { etag: string; json: string; updatedAt: string }>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = (): SyncState => this.state;
  private set(change: Partial<SyncState>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((fn) => fn());
  }

  /**
   * `owner`: whose shared copy this is (the team, or the coach alone). A different owner than
   * last time means a different copy, so what this device matched before no longer applies.
   */
  start(owner: string): void {
    if (this.started || typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(OWNER_KEY) !== owner) {
        writeMeta({});
        window.localStorage.setItem(OWNER_KEY, owner);
      }
    } catch {
      // No storage: nothing to remember either way.
    }
    this.started = true;
    this.set({ status: "syncing", message: "" });
    window.addEventListener(CHANGED_EVENT, this.onChanged);
    window.addEventListener("online", this.syncAll);
    document.addEventListener("visibilitychange", this.onVisible);
    this.poll = setInterval(() => document.visibilityState === "visible" && void this.syncAll(), POLL_MS);
    void this.syncAll();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener(CHANGED_EVENT, this.onChanged);
    window.removeEventListener("online", this.syncAll);
    document.removeEventListener("visibilitychange", this.onVisible);
    if (this.poll) clearInterval(this.poll);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.poll = this.pushTimer = null;
    this.pending.clear();
    this.set({ status: "off", conflicts: [], message: "" });
  }

  private onChanged = () => {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.syncAll(), PUSH_DELAY_MS);
  };
  private onVisible = () => {
    if (document.visibilityState === "visible") void this.syncAll();
  };

  /** Sync everything, one slot at a time, never two syncs at once. */
  syncAll = (): Promise<void> => {
    this.chain = this.chain.then(async () => {
      if (!this.started) return;
      this.set({ status: this.state.conflicts.length ? "conflict" : "syncing" });
      let offline = false;
      for (const slot of SYNC_SLOTS) {
        if (!this.started) return;
        const outcome = await this.syncSlot(slot);
        if (outcome === "denied") {
          this.stop();
          return;
        }
        if (outcome === "error") offline = true;
      }
      if (this.state.conflicts.length) this.set({ status: "conflict" });
      else if (offline) {
        this.set({ status: typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error", message: "" });
      } else this.set({ status: "synced", lastSyncedAt: Date.now(), message: "" });
    });
    return this.chain;
  };

  private async syncSlot(slot: SyncSlot): Promise<"ok" | "denied" | "error"> {
    const meta = readMeta()[slot] ?? { etag: null, dirty: false };
    const local = readLocal(slot);
    const remote = await pullSlot(slot, meta.etag);
    if (remote.kind === "denied") return "denied";
    if (remote.kind === "error") return "error";
    if (remote.kind === "data" && !isValidRemote(slot, remote.json)) return "error";

    const known = remote.kind === "none" ? null : { etag: remote.kind === "unchanged" ? (meta.etag ?? "") : remote.etag };
    const decision = decideSync({ hasLocal: local.has, dirty: meta.dirty, base: meta.etag, remote: known });

    if (decision === "idle") {
      this.dropConflict(slot);
      return "ok";
    }
    if (decision === "pull" && remote.kind === "data") {
      this.apply(slot, remote.etag, remote.json);
      return "ok";
    }
    if (decision === "conflict" && remote.kind === "data") {
      this.pending.set(slot, { etag: remote.etag, json: remote.json, updatedAt: remote.updatedAt });
      this.set({
        conflicts: [...this.state.conflicts.filter((c) => c.slot !== slot), { slot, updatedAt: remote.updatedAt }],
      });
      return "ok";
    }
    if (decision === "push" && local.json) return this.push(slot, local.json, known?.etag ?? null);
    return "ok";
  }

  private async push(slot: SyncSlot, json: string, base: string | null): Promise<"ok" | "denied" | "error"> {
    const result = await pushSlot(slot, json, base);
    if (result.kind === "ok") {
      setSlotMeta(slot, { etag: result.etag, dirty: false });
      this.dropConflict(slot);
      return "ok";
    }
    if (result.kind === "denied") return "denied";
    if (result.kind === "conflict") {
      // Someone saved between our look and our save: look again, which sorts it out.
      this.set({ message: "Your staff saved at the same time; checking." });
      setTimeout(() => void this.syncAll(), 500);
      return "ok";
    }
    if (result.kind === "too_big") this.set({ message: "This is too big to save to your staff; it stays on this device." });
    return result.kind === "too_big" ? "ok" : "error";
  }

  private apply(slot: SyncSlot, etag: string, json: string): void {
    try {
      window.localStorage.setItem(LOCAL_KEYS[slot], json);
    } catch {
      return;
    }
    setSlotMeta(slot, { etag, dirty: false });
    this.dropConflict(slot);
    window.dispatchEvent(new CustomEvent(REMOTE_APPLIED_EVENT, { detail: { slot } }));
  }

  private dropConflict(slot: SyncSlot): void {
    this.pending.delete(slot);
    if (this.state.conflicts.some((c) => c.slot === slot)) {
      this.set({ conflicts: this.state.conflicts.filter((c) => c.slot !== slot) });
    }
  }

  /** The coach's choice for a conflict: the staff's copy, or this device's. */
  async resolve(slot: SyncSlot, keep: "staff" | "mine"): Promise<void> {
    const theirs = this.pending.get(slot);
    if (!theirs) return;
    if (keep === "staff") {
      this.apply(slot, theirs.etag, theirs.json);
    } else {
      // Save ours over the copy we just saw; if it moved again, the next sync asks again.
      const local = readLocal(slot);
      if (local.json) {
        const result = await pushSlot(slot, local.json, theirs.etag);
        if (result.kind === "ok") {
          setSlotMeta(slot, { etag: result.etag, dirty: false });
          this.dropConflict(slot);
        }
      }
    }
    if (!this.state.conflicts.length) await this.syncAll();
  }
}

export const cloudSync = new CloudSyncEngine();

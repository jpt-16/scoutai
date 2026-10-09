/**
 * What the cloud sync needs to know on the device, kept apart from the sync engine
 * so the stores (scriptStore, practicePlan) can say "this changed" without pulling
 * in the network code: which of the three saved things there are, where each lives
 * in localStorage, and whether it has changes the staff's copy hasn't seen.
 */

/** The three things a staff shares: the week's scout script, its playbook, its playsheet. */
export type SyncSlot = "script" | "playbook" | "practice";
export const SYNC_SLOTS: SyncSlot[] = ["script", "playbook", "practice"];

export function isSyncSlot(value: unknown): value is SyncSlot {
  return typeof value === "string" && (SYNC_SLOTS as string[]).includes(value);
}

/** Where each slot lives on the device (the same keys scriptStore and practicePlan use). */
export const LOCAL_KEYS: Record<SyncSlot, string> = {
  script: "scoutcard:script:v1",
  playbook: "scoutcard:playbook:v1",
  practice: "scoutcard:practice:v1",
};

const META_KEY = "scoutcard:sync:v1";

/** `etag`: the staff's copy this device last matched (null = never synced); `dirty`: edited since. */
export interface SlotMeta {
  etag: string | null;
  dirty: boolean;
}

export type SyncMeta = Partial<Record<SyncSlot, SlotMeta>>;

export function readMeta(): SyncMeta {
  try {
    const raw = window.localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as SyncMeta) : {};
  } catch {
    return {};
  }
}

export function writeMeta(meta: SyncMeta): void {
  try {
    window.localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // Private mode: sync just treats everything as unsynced next time.
  }
}

export function setSlotMeta(slot: SyncSlot, change: Partial<SlotMeta>): void {
  const meta = readMeta();
  meta[slot] = { etag: null, dirty: false, ...meta[slot], ...change };
  writeMeta(meta);
}

export const CHANGED_EVENT = "scoutcard:changed";
export const REMOTE_APPLIED_EVENT = "scoutcard:remote-applied";

/** A save on this device: remember it's ahead of the staff's copy and tell the sync engine. */
export function notifyLocalChange(slot: SyncSlot): void {
  if (typeof window === "undefined") return;
  setSlotMeta(slot, { dirty: true });
  try {
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { slot } }));
  } catch {
    // No events in this environment (tests): the dirty flag is enough.
  }
}

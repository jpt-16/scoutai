import { deriveCard, type HudlParseResult, type HudlPlayCard } from "./hudlParser";
import type { DbAlignments } from "./secondary";
import { notifyLocalChange } from "./syncMeta";

/**
 * The loaded script lives in localStorage so the reader keeps working on the
 * practice field with no connection, and survives the iPad killing the tab.
 */
/**
 * Two slots: `script` is the opponent's scout script (the default, everything
 * else in the app reads and writes it), and `playbook` is the staff's own
 * playbook, kept apart so studying your own plays never touches the week's
 * scout script.
 */
export type ScriptSlot = "script" | "playbook";
const STORAGE_KEYS: Record<ScriptSlot, string> = {
  script: "scoutcard:script:v1",
  playbook: "scoutcard:playbook:v1",
};
const DEFAULT_TITLE: Record<ScriptSlot, string> = { script: "Scout script", playbook: "Our playbook" };

export interface StoredScript {
  /** Display name: one film's file name, or "a.csv + 2 more". */
  fileName: string;
  /** Every film (file name) the plays came from. */
  films: string[];
  savedAt: string;
  cards: HudlPlayCard[];
  warnings: string[];
  /** The opponent's secondary per formation, for Scout D cards (src/lib/secondary.ts). */
  dbAlignments?: DbAlignments;
}

export function scriptTitle(films: string[], slot: ScriptSlot = "script"): string {
  if (films.length <= 1) return films[0] ?? DEFAULT_TITLE[slot];
  return `${films[0]} + ${films.length - 1} more`;
}

/** Saves the script as-is (after edits, added films, etc.). */
export function storeScript(script: StoredScript, slot: ScriptSlot = "script"): StoredScript {
  const next = { ...script, fileName: scriptTitle(script.films, slot), savedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(STORAGE_KEYS[slot], JSON.stringify(next));
    // Signed in, this also goes up to the staff's copy (src/lib/cloudSync.ts).
    notifyLocalChange(slot);
  } catch {
    // Private mode or storage full: the reader falls back to its empty state.
  }
  return next;
}

/** Saves a freshly parsed single file as the whole script. */
export function saveScript(fileName: string, result: HudlParseResult, slot: ScriptSlot = "script"): StoredScript {
  return storeScript(
    {
      fileName,
      films: [fileName],
      savedAt: "",
      cards: result.cards.map((c) => ({ ...c, source: c.source || fileName })),
      warnings: result.warnings,
    },
    slot,
  );
}

export function loadScript(slot: ScriptSlot = "script"): StoredScript | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS[slot]);
    if (!raw) return null;
    const script = JSON.parse(raw) as Partial<StoredScript>;
    if (!Array.isArray(script.cards)) return null;
    const films = script.films?.length ? script.films : [script.fileName ?? DEFAULT_TITLE[slot]];
    return {
      fileName: scriptTitle(films, slot),
      films,
      savedAt: script.savedAt ?? "",
      // Re-derive so scripts saved by older versions pick up new fields.
      cards: script.cards.map((c) => deriveCard({ ...c, source: c.source || films[0] })),
      warnings: script.warnings ?? [],
      ...(script.dbAlignments ? { dbAlignments: script.dbAlignments } : {}),
    };
  } catch {
    return null;
  }
}

export function clearScript(slot: ScriptSlot = "script"): void {
  try {
    window.localStorage.removeItem(STORAGE_KEYS[slot]);
  } catch {
    // Nothing to clear.
  }
}

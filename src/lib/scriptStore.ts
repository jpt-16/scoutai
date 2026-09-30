import { deriveCard, type HudlParseResult, type HudlPlayCard } from "./hudlParser";
import type { DbAlignments } from "./secondary";

/**
 * The loaded script lives in localStorage so the reader keeps working on the
 * practice field with no connection, and survives the iPad killing the tab.
 */
const STORAGE_KEY = "scoutcard:script:v1";

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

export function scriptTitle(films: string[]): string {
  if (films.length <= 1) return films[0] ?? "Scout script";
  return `${films[0]} + ${films.length - 1} more`;
}

/** Saves the script as-is (after edits, added films, etc.). */
export function storeScript(script: StoredScript): StoredScript {
  const next = { ...script, fileName: scriptTitle(script.films), savedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or storage full: the reader falls back to its empty state.
  }
  return next;
}

/** Saves a freshly parsed single file as the whole script. */
export function saveScript(fileName: string, result: HudlParseResult): StoredScript {
  return storeScript({
    fileName,
    films: [fileName],
    savedAt: "",
    cards: result.cards.map((c) => ({ ...c, source: c.source || fileName })),
    warnings: result.warnings,
  });
}

export function loadScript(): StoredScript | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const script = JSON.parse(raw) as Partial<StoredScript>;
    if (!Array.isArray(script.cards)) return null;
    const films = script.films?.length ? script.films : [script.fileName ?? "Scout script"];
    return {
      fileName: scriptTitle(films),
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

export function clearScript(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

import type { HudlParseResult, HudlPlayCard } from "./hudlParser";

/**
 * The loaded script lives in localStorage so the reader keeps working on the
 * practice field with no connection, and survives the iPad killing the tab.
 */
const STORAGE_KEY = "scoutcard:script:v1";

export interface StoredScript {
  fileName: string;
  savedAt: string;
  cards: HudlPlayCard[];
  warnings: string[];
}

export function saveScript(fileName: string, result: HudlParseResult): StoredScript {
  const script: StoredScript = {
    fileName,
    savedAt: new Date().toISOString(),
    cards: result.cards,
    warnings: result.warnings,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(script));
  } catch {
    // Private mode or storage full: the reader falls back to its empty state.
  }
  return script;
}

export function loadScript(): StoredScript | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const script = JSON.parse(raw) as StoredScript;
    return Array.isArray(script.cards) ? script : null;
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

/**
 * A game opened from the staff's film library (`/film`) keeps its own copy of the cards on the server, so a coach's edits, Review
 * checks and route ratings are there the next time anyone opens that game, after another game has been opened in between.
 *
 * The device's script (localStorage) stays the one the reader works on; this only sends it back. After a save to a script that came
 * from a game (`StoredScript.gameId`), the game is marked as having changes here (`PENDING_KEY`, so it survives a reload or a field
 * with no signal) and sent after a short pause; the library sends it before opening another game, and asks before dropping changes
 * that couldn't be sent.
 */

import { filmApi } from "./film/client";
import { loadScript, type StoredScript } from "./scriptStore";

const PENDING_KEY = "scoutcard:game-save:v1";
/** How long after the last change the copy is sent. */
export const GAME_SAVE_DELAY_MS = 2500;

/** The game with changes on this device not yet sent, or null. */
export function pendingGameSave(): string | null {
  try {
    return window.localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

function setPending(gameId: string | null): void {
  try {
    if (gameId) window.localStorage.setItem(PENDING_KEY, gameId);
    else window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // Private mode: the pause-then-send still runs while the page is open.
  }
}

/** Notes that the open game's cards changed on this device. */
export function markGameChanged(gameId: string): void {
  setPending(gameId);
}

/** Forgets any unsent changes (the game was just opened fresh, or the coach chose to drop them). */
export function clearGameChanges(): void {
  setPending(null);
}

/** Sends this script to its game now. True when it was saved (or there was nothing to save). */
export async function saveGameNow(script: StoredScript | null = loadScript()): Promise<boolean> {
  const pending = pendingGameSave();
  if (!pending) return true;
  // The script on the device is no longer that game's: there is nothing left here to send.
  if (!script || script.gameId !== pending) {
    setPending(null);
    return true;
  }
  try {
    await filmApi.saveGame(pending, JSON.stringify(script));
  } catch {
    return false;
  }
  // Only clear it if no newer change came in while it was being sent (that one will be sent after its own pause).
  if (pendingGameSave() === pending && loadScript()?.savedAt === script.savedAt) setPending(null);
  return true;
}

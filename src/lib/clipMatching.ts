/**
 * Matches a batch of extracted clip filenames (from a Hudl zip export —
 * "Clip_4.mp4", "Play_001.mp4") to the CSV rows they belong to, by the
 * number embedded in the filename. Framework-free and pure so it's directly
 * unit-testable; used by `src/components/BatchUploader.tsx`.
 */

import type { HudlPlayCard } from "./hudlParser";

/**
 * Pulls the first run of digits out of a filename ("Clip_004.mp4" -> 4).
 * Strips the extension first — ".mp4" itself contains a digit, so a plain
 * "clip.mp4" with no play number in its name must not silently match "4".
 * Null if the (extension-stripped) name has no digits.
 */
export function extractPlayNumberFromFileName(name: string): number | null {
  const withoutExtension = name.replace(/\.[^./\\]+$/, "");
  const match = withoutExtension.match(/\d+/);
  if (!match) return null;
  const n = Number.parseInt(match[0], 10);
  return Number.isFinite(n) ? n : null;
}

export interface ClipMatch {
  fileName: string;
  /** The number read out of the filename, or null if none was found. */
  playNumber: number | null;
  /** The CSV row it matches, by `playNumber` — null if unmatched (shown as "unmatched" in the UI). */
  card: HudlPlayCard | null;
}

/**
 * Matches each clip filename to the card whose `playNumber` equals the
 * number embedded in that filename. A filename with no number, or a number
 * with no matching row, comes back with `card: null` rather than guessing —
 * the batch UI lists those separately so a coach can see what wasn't
 * matched instead of silently mis-assigning a route to the wrong play.
 */
export function matchClipsToCards(fileNames: string[], cards: HudlPlayCard[]): ClipMatch[] {
  const byPlayNumber = new Map(cards.map((c) => [c.playNumber, c]));
  return fileNames.map((fileName) => {
    const playNumber = extractPlayNumberFromFileName(fileName);
    const card = playNumber !== null ? (byPlayNumber.get(playNumber) ?? null) : null;
    return { fileName, playNumber, card };
  });
}

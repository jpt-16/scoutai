/**
 * The batch uploader's planning half: sort whatever was dropped (one Hudl
 * "video with data" zip, or loose clips plus one breakdown sheet) into clips
 * and the sheet, line each clip up with its row, and decide how every row gets
 * its card:
 *
 * - `video`: a clip matched it; the film AI draws the routes (the sheet's own
 *   down, distance, formation and call stay ground truth).
 * - `text`: no clip, and the sheet's call is one the rules can't draw (an
 *   unknown formation, or a call that reads as neither run nor pass): the text
 *   AI (`/api/generate-scout-card`) draws it.
 * - `sheet`: no clip, and the sheet already draws it (a "Trio G Iso", an
 *   "837"): the card is done, instantly and free.
 *
 * Framework-free and pure, so it's unit-tested without a zip or a network.
 */

import { extractPlayNumberFromFileName } from "./clipMatching";
import { playKind } from "./formations";
import type { HudlPlayCard } from "./hudlParser";

export const CLIP_PATTERN = /\.(mp4|mov|m4v)$/i;
export const SHEET_PATTERN = /\.(csv|xlsx)$/i;

/** Mac zip clutter and hidden files are never clips or sheets. */
const isJunk = (name: string) => /(^|\/)(__MACOSX|\.)/.test(name);

/** The file name without its folders ("Game/clip_01.mp4" → "clip_01.mp4"). */
export const baseName = (name: string) => name.split(/[\\/]/).pop() ?? name;

/** Splits dropped (or unzipped) file names into clips, sheets and anything else. */
export function sortBatchFiles<T extends { name: string }>(files: T[]): { clips: T[]; sheets: T[]; other: T[] } {
  const clips: T[] = [];
  const sheets: T[] = [];
  const other: T[] = [];
  for (const f of files) {
    if (isJunk(f.name)) continue;
    if (CLIP_PATTERN.test(f.name)) clips.push(f);
    else if (SHEET_PATTERN.test(f.name)) sheets.push(f);
    else other.push(f);
  }
  return { clips, sheets, other };
}

export type RowRoute = "video" | "text" | "sheet";

export interface BatchRow {
  card: HudlPlayCard;
  /** The matched clip's file name, or null. */
  clip: string | null;
  route: RowRoute;
}

export interface BatchPlan {
  rows: BatchRow[];
  /** Clips that matched no row (no number, or a number no row has). */
  unmatchedClips: string[];
  /** How clips were lined up: by the sheet's PLAY # column, or by row order (clip 1 = first row). */
  matchedBy: "play-number" | "row-order";
  counts: Record<RowRoute, number>;
}

/**
 * Whether the text AI should draw a row with no clip: only when the rules
 * can't (an unknown formation, or a play call that's neither run nor pass).
 */
export function needsTextAi(card: HudlPlayCard): boolean {
  if (!card.playCall.trim() && !card.formation.trim()) return false;
  const formationUnknown = Boolean(card.formation.trim()) && card.formationKey === "unknown";
  const callUnread = Boolean(card.playCall.trim()) && playKind(card) === "none";
  return formationUnknown || callUnread;
}

/**
 * Lines clips up with rows. Each clip's number ("clip_01", "Play 4") is read
 * against the sheet's PLAY # column and, separately, against row order (the
 * Nth row); whichever lines up more clips wins, PLAY # on a tie. A clip never
 * takes a row another clip already has.
 */
export function planBatch(clipNames: string[], cards: HudlPlayCard[]): BatchPlan {
  const numbered = clipNames.map((name) => ({ name, n: extractPlayNumberFromFileName(baseName(name)) }));
  const assign = (rowFor: (n: number) => HudlPlayCard | undefined) => {
    const byRow = new Map<string, string>();
    const unmatched: string[] = [];
    for (const { name, n } of numbered) {
      const card = n === null ? undefined : rowFor(n);
      if (card && !byRow.has(card.id)) byRow.set(card.id, name);
      else unmatched.push(name);
    }
    return { byRow, unmatched };
  };
  const byNumber = new Map(cards.map((c) => [c.playNumber, c]));
  const byPlay = assign((n) => byNumber.get(n));
  const byOrder = assign((n) => cards[n - 1]);
  const useOrder = byOrder.byRow.size > byPlay.byRow.size;
  const { byRow, unmatched } = useOrder ? byOrder : byPlay;

  const rows: BatchRow[] = cards.map((card) => {
    const clip = byRow.get(card.id) ?? null;
    return { card, clip, route: clip ? "video" : needsTextAi(card) ? "text" : "sheet" };
  });
  const counts = { video: 0, text: 0, sheet: 0 };
  for (const r of rows) counts[r.route] += 1;
  return { rows, unmatchedClips: unmatched, matchedBy: useOrder ? "row-order" : "play-number", counts };
}

/** "Play 1: clip_01.mp4 ↔ TRIO · SLOT RPO BUBBLE" for the checklist. */
export function checklistLabel(row: BatchRow): string {
  const play = [row.card.formation, row.card.playCall].map((s) => s.trim()).filter(Boolean).join(" · ") || "—";
  return row.clip
    ? `Play ${row.card.playNumber}: ${baseName(row.clip)} ↔ ${play}`
    : `Play ${row.card.playNumber}: ${play}`;
}

/** The text AI's request for a row: its call, formation, and the look it was run against. */
export function textAiRequest(card: HudlPlayCard): { playName: string; formation: string; defensiveCall: string } {
  return {
    playName: card.playCall.trim() || card.formation.trim(),
    formation: card.formation.trim(),
    defensiveCall: [card.defFront, card.coverage].map((s) => s.trim()).filter(Boolean).join(" "),
  };
}

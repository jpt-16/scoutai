/**
 * Review mode: a coach goes through the plays, taps "Looks right" or fixes the tag, and
 * the app keeps score. Hudl Assist's tags are wrong often enough that a coach re-checks
 * every game on Sunday; this makes that a one-tap pass per play, and every fix is kept
 * next to what the file said (`card.tagged`), which gives two things:
 *
 *  - an accuracy line for the tags the file came with ("formation right on 41 of 48"),
 *  - the pair of sheets, as tagged and as corrected, that `video-service/eval/score.py`
 *    compares a computer-vision read against.
 *
 * "Changed" is judged by meaning, not spelling: retyping "TRIO RT" as "Trips Rt" is not a
 * fix, "Pro Rt" to "Trips Rt" is.
 */

import Papa from "papaparse";
import { FORMATION_LABELS } from "./formations";
import {
  classifyFormation,
  classifyFront,
  parseSide,
  parseSideTag,
  snapshotTags,
  type HudlPlayCard,
  type RouteCheck,
  type TagSnapshot,
} from "./hudlParser";

export type TagField = "formation" | "strength" | "playCall" | "direction" | "hash" | "front" | "coverage";

export const TAG_FIELDS: { field: TagField; label: string }[] = [
  { field: "formation", label: "Formation" },
  { field: "strength", label: "Strength" },
  { field: "playCall", label: "Play call" },
  { field: "direction", label: "Direction" },
  { field: "hash", label: "Hash" },
  { field: "front", label: "Front" },
  { field: "coverage", label: "Coverage" },
];

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();

/** What each tag means, so two spellings of the same thing compare equal. */
const MEANING: Record<TagField, (t: TagSnapshot) => string> = {
  formation: (t) => {
    const key = classifyFormation(t.formation);
    return key !== "unknown" ? key : `text:${norm(t.formation)}`;
  },
  strength: (t) => parseSideTag(t.offStrength) ?? parseSide(t.formation) ?? "",
  playCall: (t) => norm(t.playCall),
  direction: (t) => parseSideTag(t.playDir) ?? parseSide(t.playCall) ?? "",
  hash: (t) => t.hash ?? "",
  front: (t) => {
    const key = classifyFront(t.defFront);
    return key !== "unknown" ? key : `text:${norm(t.defFront)}`;
  },
  coverage: (t) => norm(t.coverage),
};

/** The tags a coach changed from what the file said. Empty for a play with no snapshot. */
export function changedFields(card: HudlPlayCard): TagField[] {
  if (!card.tagged) return [];
  const now = snapshotTags(card);
  const was = card.tagged;
  return TAG_FIELDS.map((f) => f.field).filter((f) => MEANING[f](was) !== MEANING[f](now));
}

export type ReviewStatus = "unchecked" | "right" | "fixed";

export function reviewStatus(card: HudlPlayCard): ReviewStatus {
  if (!card.reviewedAt) return "unchecked";
  return changedFields(card).length > 0 ? "fixed" : "right";
}

export interface ReviewSummary {
  total: number;
  checked: number;
  /** Checked and left as the file tagged it. */
  right: number;
  /** Checked and at least one tag changed. */
  fixed: number;
  /** Per tag: how many checked plays had it wrong. */
  wrong: Record<TagField, number>;
  /** The formation fixes that came up most, "Pro Right → Trips Right". */
  formationFixes: { from: string; to: string; count: number }[];
}

export function summarize(cards: HudlPlayCard[]): ReviewSummary {
  const wrong = Object.fromEntries(TAG_FIELDS.map((f) => [f.field, 0])) as Record<TagField, number>;
  const fixes = new Map<string, { from: string; to: string; count: number }>();
  let checked = 0;
  let fixed = 0;
  for (const card of cards) {
    if (!card.reviewedAt) continue;
    checked += 1;
    const changed = changedFields(card);
    if (changed.length > 0) fixed += 1;
    for (const f of changed) wrong[f] += 1;
    if (changed.includes("formation") && card.tagged) {
      const label = (text: string) => {
        const key = classifyFormation(text);
        return key !== "unknown" ? FORMATION_LABELS[key] : text.trim() || "(blank)";
      };
      const from = label(card.tagged.formation);
      const to = label(card.formation);
      const k = `${from}→${to}`;
      fixes.set(k, { from, to, count: (fixes.get(k)?.count ?? 0) + 1 });
    }
  }
  return {
    total: cards.length,
    checked,
    right: checked - fixed,
    fixed,
    wrong,
    formationFixes: [...fixes.values()].sort((a, b) => b.count - a.count).slice(0, 5),
  };
}

/* ------------------------------ The two sheets ------------------------------ */

/** The same column names a Hudl export uses, so either sheet loads back into the app. */
const COLUMNS = ["PLAY #", "FILM", "OFF FORM", "OFF STR", "OFF PLAY", "PLAY DIR", "HASH", "DEF FRONT", "COVERAGE"] as const;

function row(card: HudlPlayCard, tags: TagSnapshot) {
  return {
    "PLAY #": card.playNumber,
    FILM: card.source,
    "OFF FORM": tags.formation,
    "OFF STR": tags.offStrength,
    "OFF PLAY": tags.playCall,
    "PLAY DIR": tags.playDir,
    HASH: tags.hash ?? "",
    "DEF FRONT": tags.defFront,
    COVERAGE: tags.coverage,
  };
}

/** The checked plays with their tags as the file wrote them (what Hudl Assist said). */
export function taggedCsv(cards: HudlPlayCard[]): string {
  const checked = cards.filter((c) => c.reviewedAt && c.tagged);
  return Papa.unparse({ fields: [...COLUMNS], data: checked.map((c) => row(c, c.tagged!)) });
}

/** The same plays with the coach's corrected tags. */
export function correctedCsv(cards: HudlPlayCard[]): string {
  const checked = cards.filter((c) => c.reviewedAt && c.tagged);
  return Papa.unparse({ fields: [...COLUMNS], data: checked.map((c) => row(c, snapshotTags(c))) });
}

/** The next play after `from` that hasn't been checked, wrapping around; null when all are. */
export function nextUnchecked(cards: HudlPlayCard[], from: number): number | null {
  for (let step = 1; step <= cards.length; step++) {
    const i = (from + step) % cards.length;
    if (!cards[i].reviewedAt) return i;
  }
  return null;
}

/* ------------------------------ Route check ------------------------------ */

/*
 * The film draws each receiver's and back's route as he ran it (unnamed), and the coach rates each one while flipping through:
 * right, close (the right route, the shape a bit off) or wrong. Every Sunday review then adds to the measure of how well the film
 * reads routes, with no separate sheet to fill in, and `routeChecksCsv` hands the ratings to the scoring scripts.
 */

export const ROUTE_CHECKS: { check: RouteCheck; label: string }[] = [
  { check: "right", label: "Right" },
  { check: "close", label: "Close" },
  { check: "wrong", label: "Wrong" },
];

/** The staff's letters, left to right across the offense, then the back. */
const LETTER_ORDER = ["X", "F", "Y", "Z", "H"];
const byLetter = (a: string, b: string) => {
  const ia = LETTER_ORDER.indexOf(a);
  const ib = LETTER_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
};

/**
 * The letters whose route on this card the film drew (a `source: "video"` route, dragged by a coach or not), plus any already
 * rated, so a rating isn't hidden when a coach later picks a route by hand in Edit play.
 */
export function filmRouteLetters(card: HudlPlayCard): string[] {
  const letters = new Set<string>();
  for (const [letter, o] of Object.entries(card.routeOverrides ?? {})) if (o.source === "video" && o.path?.length) letters.add(letter);
  for (const letter of Object.keys(card.routeChecks ?? {})) letters.add(letter);
  return [...letters].sort(byLetter);
}

/** The card with one letter's route rated (or the rating taken off, with `null`). */
export function withRouteCheck(card: HudlPlayCard, letter: string, check: RouteCheck | null): HudlPlayCard {
  const checks = { ...card.routeChecks };
  if (check) checks[letter] = check;
  else delete checks[letter];
  const next: HudlPlayCard = { ...card, routeChecks: checks };
  if (Object.keys(checks).length === 0) delete next.routeChecks;
  return next;
}

export interface RouteCheckSummary {
  /** Film routes across the script. */
  total: number;
  rated: number;
  right: number;
  close: number;
  wrong: number;
  /** Per letter, the same counts (letters in the staff's order). */
  letters: { letter: string; rated: number; right: number; close: number; wrong: number }[];
}

export function summarizeRoutes(cards: HudlPlayCard[]): RouteCheckSummary {
  const out: RouteCheckSummary = { total: 0, rated: 0, right: 0, close: 0, wrong: 0, letters: [] };
  const per = new Map<string, RouteCheckSummary["letters"][number]>();
  for (const card of cards) {
    for (const letter of filmRouteLetters(card)) {
      out.total += 1;
      const check = card.routeChecks?.[letter];
      if (!check) continue;
      out.rated += 1;
      out[check] += 1;
      const row = per.get(letter) ?? { letter, rated: 0, right: 0, close: 0, wrong: 0 };
      row.rated += 1;
      row[check] += 1;
      per.set(letter, row);
    }
  }
  out.letters = [...per.values()].sort((a, b) => byLetter(a.letter, b.letter));
  return out;
}

/** One row per rated route: the play, the letter, the coach's rating and the drawn shape (card units, from his spot). */
export function routeChecksCsv(cards: HudlPlayCard[]): string {
  const data = cards.flatMap((card) =>
    filmRouteLetters(card)
      .filter((letter) => card.routeChecks?.[letter])
      .map((letter) => {
        const o = card.routeOverrides?.[letter];
        return {
          "PLAY #": card.playNumber,
          FILM: card.source,
          "OFF FORM": card.formation,
          "OFF PLAY": card.playCall,
          LETTER: letter,
          CHECK: card.routeChecks![letter],
          DRAWN: o?.source === "video" && o.path ? JSON.stringify(o.path) : "",
        };
      }),
  );
  return Papa.unparse({ fields: ["PLAY #", "FILM", "OFF FORM", "OFF PLAY", "LETTER", "CHECK", "DRAWN"], data });
}

/**
 * Scoring the film's route reads against the coach's call: the number the analyzer is judged by
 * (the goal is 90%+ of routes right, to beat Hudl Assist, which reads none).
 *
 * The key for a play is its corrected call, drawn by `buildDiagram` into a route per letter, the
 * same way the card draws it ("FADE SPEED OUT HITCH FADE" in Deuces: Z fade, Y speed out, H hitch,
 * X fade). A receiver with no route on the call (a stalk, a protect) is keyed "block". The reads
 * are what `cardFromTracks` matched to each letter. Two numbers come out, because the product can
 * flag what it isn't sure of: accuracy over every keyed route, and accuracy over the reads it
 * committed to (not "unknown", confidence at least `SURE_CONFIDENCE`), with how many it committed to.
 */

import { buildDiagram, type RouteKind } from "./formations";
import type { HudlPlayCard } from "./hudlParser";
import { SURE_CONFIDENCE, type TrackedRead } from "./trackedPlay";

export type KeyKind = RouteKind | "block";

/** Routes a coach would call the same thing on a scout card. Lenient scoring only. */
const SAME_ENOUGH: [RouteKind, RouteKind][] = [["fade", "go"]];

/** The route each letter runs on this card's call; null for a route drawn by shape alone (no route-tree name). */
export function keyRoutes(card: HudlPlayCard): Map<string, KeyKind | null> {
  const d = buildDiagram(card, "team", "offense");
  const key = new Map<string, KeyKind | null>();
  d.routeLetters.forEach((letter, i) => {
    // A go and a fade are the same route to this staff: the key says fade for both.
    const kind = (d.routeKinds[i] as RouteKind | null) ?? null;
    if (letter && letter !== "Q") key.set(letter, kind === "go" ? "fade" : kind);
  });
  // Everyone else with a job and no route blocks (a stalk, pass pro, a lead).
  for (const [letter, job] of Object.entries(d.jobs)) {
    if (letter === "Q" || key.has(letter) || !job) continue;
    if (/stalk|protect|block|pass pro|lead|crack|kick|fake/i.test(job)) key.set(letter, "block");
  }
  return key;
}

export interface RouteVerdict {
  letter: string;
  key: KeyKind | null;
  read: TrackedRead | null;
  /** The read is the key route. */
  right: boolean;
  /** Right once GO and FADE count as the same route. */
  rightLenient: boolean;
  /** The analyzer committed to this read (it would be drawn without a "check" note). */
  committed: boolean;
}

function same(a: string, b: string, lenient: boolean): boolean {
  if (a === b) return true;
  return lenient && SAME_ENOUGH.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

/** Every keyed letter of one play against what was read for it. Letters keyed null are left out (nothing to check against). */
export function scorePlay(key: Map<string, KeyKind | null>, reads: TrackedRead[]): RouteVerdict[] {
  const byLetter = new Map(reads.map((r) => [r.letter, r]));
  const out: RouteVerdict[] = [];
  for (const [letter, k] of key) {
    if (k === null) continue;
    const read = byLetter.get(letter) ?? null;
    const committed = !!read && read.kind !== "unknown" && (read.kind === "block" || read.confidence >= SURE_CONFIDENCE);
    const right = !!read && same(read.kind, k, false);
    out.push({ letter, key: k, read, right, rightLenient: !!read && same(read.kind, k, true), committed });
  }
  return out;
}

export interface RouteScore {
  /** Keyed receivers who ran a route (blocks are counted on their own). */
  routes: number;
  right: number;
  rightLenient: number;
  /** Routes the analyzer committed to, and how many of those were right. */
  committed: number;
  committedRight: number;
  /** Receivers keyed as blocking, and how many were read as blocking. */
  blocks: number;
  blocksRight: number;
  /** No tracked man was matched to the letter at all. */
  missing: number;
  /** Per key route: [right, total]. */
  byRoute: Record<string, [number, number]>;
  /** "key → read" mistakes, most common first. */
  mistakes: [string, number][];
}

export function summarize(verdicts: RouteVerdict[]): RouteScore {
  const s: RouteScore = {
    routes: 0, right: 0, rightLenient: 0, committed: 0, committedRight: 0,
    blocks: 0, blocksRight: 0, missing: 0, byRoute: {}, mistakes: [],
  };
  const mistakes = new Map<string, number>();
  for (const v of verdicts) {
    if (!v.read) s.missing++;
    if (v.key === "block") {
      s.blocks++;
      if (v.right) s.blocksRight++;
      continue;
    }
    if (!v.key) continue;
    s.routes++;
    if (v.right) s.right++;
    if (v.rightLenient) s.rightLenient++;
    if (v.committed) {
      s.committed++;
      if (v.right) s.committedRight++;
    }
    const tally = (s.byRoute[v.key] ??= [0, 0]);
    tally[1]++;
    if (v.right) tally[0]++;
    else {
      const label = `${v.key} → ${v.read ? v.read.kind : "not tracked"}`;
      mistakes.set(label, (mistakes.get(label) ?? 0) + 1);
    }
  }
  s.mistakes = [...mistakes].sort((a, b) => b[1] - a[1]);
  return s;
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");

/** The report printed by `scripts/score-routes.ts`. */
export function report(s: RouteScore): string[] {
  const lines = [
    `Routes right: ${s.right} of ${s.routes} (${pct(s.right, s.routes)})` +
      `  ·  counting GO = FADE: ${s.rightLenient} (${pct(s.rightLenient, s.routes)})`,
    `Committed (drawn without a "check" note): ${s.committed} of ${s.routes} (${pct(s.committed, s.routes)}),` +
      ` right ${s.committedRight} of those (${pct(s.committedRight, s.committed)})`,
    `Blocking receivers read as blocking: ${s.blocksRight} of ${s.blocks} (${pct(s.blocksRight, s.blocks)})`,
    `Keyed receivers with no track at all: ${s.missing}`,
    "By route: " +
      Object.entries(s.byRoute)
        .sort((a, b) => b[1][1] - a[1][1])
        .map(([k, [r, t]]) => `${k} ${r}/${t}`)
        .join(", "),
  ];
  if (s.mistakes.length) lines.push("Most common misses: " + s.mistakes.slice(0, 8).map(([m, n]) => `${m} ×${n}`).join(", "));
  return lines;
}

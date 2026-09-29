/**
 * Scout-report tendency stats for a whole script (or any filtered set of
 * cards) — formation usage, run/pass splits by down-and-distance situation,
 * hash distribution, and preferred play direction. Computed once per script
 * (`computeTendencies`) and read per-card by `ScoutCard`'s badge row via the
 * small lookup helpers below, rather than stored on each `HudlPlayCard` —
 * these are properties of the whole collection of plays, not of any one
 * play, so storing them per-card would just be the same numbers copied onto
 * every row. Framework-free, so it's directly unit-testable.
 *
 * Two assumptions worth flagging rather than guessing silently:
 * - Run/pass classification reuses `formations.ts`'s `playKind`: "run" counts
 *   as a run, "pass" and "pa" (play action) count as a pass. RPO and "none"
 *   (untagged) plays are genuinely both/neither, so they're left out of the
 *   run/pass ratio entirely rather than forced into one bucket.
 * - Distance buckets: 1-3 yards (and any goal-to-go) is "Short", 4-6 is
 *   "Medium", 7+ is "Long" — a common convention, but not one this app's
 *   coaching-derived rules (CLAUDE.md) specify, so treat it as a reasonable
 *   default rather than a staff-verified rule.
 */

import type { Hash, HudlPlayCard } from "./hudlParser";
import { playKind } from "./formations";

const MIN_SITUATION_REPS = 2;

export interface FormationShare {
  /** The opponent's own formation name as Hudl tagged it, not this app's canonical formation keys. */
  formation: string;
  count: number;
  /** 0-100, rounded, share of plays with a tagged formation. */
  pct: number;
}

export interface SituationSplit {
  situation: string;
  run: number;
  pass: number;
  total: number;
  /** 0-100, rounded. */
  runPct: number;
}

export type HashSplit = Record<Hash, number> & { total: number };

export interface ScriptTendencies {
  totalPlays: number;
  /** Sorted by count, descending. Empty when no play has a tagged formation. */
  formationShare: FormationShare[];
  /** Keyed by situation label ("2nd & Short"). Only down/distance combinations that appear. */
  situationSplits: Record<string, SituationSplit>;
  hashSplit: HashSplit;
  directionSplit: { left: number; right: number; total: number };
}

function distanceBucketLabel(card: Pick<HudlPlayCard, "distance" | "isGoalToGo">): "Short" | "Medium" | "Long" {
  if (card.isGoalToGo) return "Short";
  if (card.distance == null) return "Medium"; // unknown: don't skew the label toward an extreme
  if (card.distance <= 3) return "Short";
  if (card.distance <= 6) return "Medium";
  return "Long";
}

const DOWN_LABELS: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" };

/** e.g. "2nd & Short". `null` when the row has no down (nothing to bucket by). */
export function situationKey(card: Pick<HudlPlayCard, "down" | "distance" | "isGoalToGo">): string | null {
  if (card.down == null) return null;
  const downLabel = DOWN_LABELS[card.down] ?? `${card.down}th`;
  return `${downLabel} & ${distanceBucketLabel(card)}`;
}

function runPassBucket(card: Pick<HudlPlayCard, "playCall" | "concept">): "run" | "pass" | null {
  const kind = playKind(card);
  if (kind === "run") return "run";
  if (kind === "pass" || kind === "pa") return "pass";
  return null;
}

export function computeTendencies(cards: HudlPlayCard[]): ScriptTendencies {
  const formationCounts = new Map<string, number>();
  const situationSplits: Record<string, SituationSplit> = {};
  const hashSplit: HashSplit = { L: 0, M: 0, R: 0, total: 0 };
  const directionSplit = { left: 0, right: 0, total: 0 };

  for (const card of cards) {
    const formation = card.formation.trim().toUpperCase();
    if (formation) formationCounts.set(formation, (formationCounts.get(formation) ?? 0) + 1);

    const bucket = runPassBucket(card);
    const situation = situationKey(card);
    if (situation && bucket) {
      const entry = situationSplits[situation] ?? { situation, run: 0, pass: 0, total: 0, runPct: 0 };
      entry[bucket] += 1;
      entry.total += 1;
      entry.runPct = Math.round((entry.run / entry.total) * 100);
      situationSplits[situation] = entry;
    }

    if (card.hash) {
      hashSplit[card.hash] += 1;
      hashSplit.total += 1;
    }

    if (bucket) {
      if (card.playDirection === "left") directionSplit.left += 1;
      else if (card.playDirection === "right") directionSplit.right += 1;
      directionSplit.total += 1;
    }
  }

  const formationTotal = [...formationCounts.values()].reduce((a, b) => a + b, 0);
  const formationShare = [...formationCounts.entries()]
    .map(([formation, count]) => ({
      formation,
      count,
      pct: formationTotal ? Math.round((count / formationTotal) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return { totalPlays: cards.length, formationShare, situationSplits, hashSplit, directionSplit };
}

/** This card's formation-share badge value, or `null` with no usable data. */
export function formationSharePct(
  tendencies: ScriptTendencies,
  card: Pick<HudlPlayCard, "formation">,
): number | null {
  const formation = card.formation.trim().toUpperCase();
  if (!formation) return null;
  return tendencies.formationShare.find((f) => f.formation === formation)?.pct ?? null;
}

/** This card's down/distance situation run%, or `null` with too few reps in that bucket to mean anything. */
export function situationRunPct(
  tendencies: ScriptTendencies,
  card: Pick<HudlPlayCard, "down" | "distance" | "isGoalToGo">,
): number | null {
  const key = situationKey(card);
  const split = key ? tendencies.situationSplits[key] : undefined;
  if (!split || split.total < MIN_SITUATION_REPS) return null;
  return split.runPct;
}

/** The script's preferred play direction, or `null` with too little data or an exact split. */
export function preferredDirection(tendencies: ScriptTendencies): { side: "left" | "right"; pct: number } | null {
  const { left, right, total } = tendencies.directionSplit;
  if (total < MIN_SITUATION_REPS || left === right) return null;
  const side = left > right ? "left" : "right";
  return { side, pct: Math.round((Math.max(left, right) / total) * 100) };
}

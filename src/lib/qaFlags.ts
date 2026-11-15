/**
 * Automatic checks on a script's plays: what a coach should look at before trusting a card. Nothing here reads film or
 * guesses; every flag comes from something the app already knows about the play (a note the film reader wrote about its
 * own doubt, a value that can't be right, a tag the classifiers couldn't place), so a flag always says why.
 *
 * Two levels. **check** is something likely wrong or unsure: those count toward "needs a look" and open as a list in the
 * reader. **info** is worth a glance but often fine (a penalty makes down and distance skip), so it shows on the play and
 * never counts. A coach who has checked a play in Review mode (`reviewedAt`) has looked at what the film wasn't sure of,
 * so the film's own doubts stop flagging it; values that can't be right keep flagging until they're fixed.
 *
 * Framework-free.
 */

import { playKind } from "./formations";
import type { HudlPlayCard } from "./hudlParser";
import { parseGain } from "./scoutReport";

export type FlagLevel = "check" | "info";

export interface QaFlag {
  /** Stable name of the check, for tests and filters. */
  code: "film-doubt" | "situation" | "formation" | "front" | "call" | "sequence";
  level: FlagLevel;
  /** What to tell the coach, in one sentence. */
  message: string;
}

const DOWN_NAMES = ["", "1st", "2nd", "3rd", "4th"];

/** The sentences of a card's notes the film reader wrote about its own doubt ("Check routes: Y (dig or shallow).", "Lost early on film, check: Z (1.6 s)."). */
export function filmDoubts(notes: string): string[] {
  return notes
    .split(/(?<=\.)\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /^(Check |Lost early on film|Tapped, but|Tapped on one man)/.test(s));
}

/** Flags that need only this play. */
export function qaFlags(card: HudlPlayCard): QaFlag[] {
  const flags: QaFlag[] = [];

  if (!card.reviewedAt) {
    for (const message of filmDoubts(card.notes)) flags.push({ code: "film-doubt", level: "check", message });
  }

  const impossible: string[] = [];
  if (card.down != null && (card.down < 1 || card.down > 4)) impossible.push(`down ${card.down}`);
  if (!card.isGoalToGo && card.distance != null && (card.distance < 1 || card.distance > 99)) impossible.push(`${card.distance} to go`);
  if (card.yardLine != null && Math.abs(card.yardLine) > 50) impossible.push(`yard line ${card.yardLineLabel || card.yardLine}`);
  if (impossible.length) {
    flags.push({ code: "situation", level: "check", message: `Can't be right: ${impossible.join(", ")}. Fix it in Edit play.` });
  }

  if (card.formation.trim() && card.formationKey === "unknown") {
    flags.push({ code: "formation", level: "check", message: `Formation "${card.formation.trim()}" isn't one the app knows, so the card can't draw it. Pick one in Edit play.` });
  }
  if (card.defFront.trim() && card.frontKey === "unknown") {
    flags.push({ code: "front", level: "check", message: `Front "${card.defFront.trim()}" isn't one the app knows, so it draws a 4-3. Pick one in Edit play.` });
  }
  if (card.playCall.trim() && playKind(card) === "none" && !card.routeOverrides) {
    flags.push({ code: "call", level: "info", message: `The call "${card.playCall.trim()}" isn't read as a run or a pass, so the card shows the formation only.` });
  }
  return flags;
}

const downAndDistance = (down: number, distance: number | null) => `${DOWN_NAMES[down] ?? `${down}th`} & ${distance ?? "G"}`;

/**
 * What the situation after a play should be, from its result: a gain that reaches the sticks is 1st down, a short one
 * is the next down with the yards left. Null when the result doesn't say plainly or the play can't be followed (a
 * 4th-down stop, a goal-to-go).
 */
export function expectedNext(prev: HudlPlayCard): { down: number; distance: number | null } | null {
  if (prev.down == null || prev.distance == null || prev.isGoalToGo) return null;
  const gain = parseGain(prev.result);
  if (gain == null) return null;
  if (gain >= prev.distance) return { down: 1, distance: null }; // 1st & 10 (or less near the goal): the distance isn't checked
  if (prev.down >= 4) return null; // turnover on downs: the next play is the other team's
  return { down: prev.down + 1, distance: prev.distance - gain };
}

/** Flags for every card of a script, by card id: each play's own, and down and distance that don't follow the play before it. */
export function qaFlagMap(cards: HudlPlayCard[]): Map<string, QaFlag[]> {
  const out = new Map<string, QaFlag[]>();
  const byPlay = new Map<string, HudlPlayCard>();
  for (const c of cards) {
    const key = `${c.source}#${c.playNumber}`;
    if (!byPlay.has(key)) byPlay.set(key, c);
  }
  for (const card of cards) {
    const flags = qaFlags(card);
    const prev = byPlay.get(`${card.source}#${card.playNumber - 1}`);
    const want = prev && prev.id !== card.id ? expectedNext(prev) : null;
    if (prev && want && card.down != null) {
      const downOk = card.down === want.down;
      const distanceOk = want.distance == null || card.distance === want.distance;
      if (!downOk || !distanceOk) {
        flags.push({
          code: "sequence",
          level: "info",
          message: `After play ${prev.playNumber} (${downAndDistance(prev.down!, prev.distance)}, ${prev.result.trim()}) this should be ${downAndDistance(want.down, want.distance ?? 10)}${want.distance == null ? " or less" : ""}, not ${downAndDistance(card.down, card.distance)}. A penalty would explain it.`,
        });
      }
    }
    if (flags.length) out.set(card.id, flags);
  }
  return out;
}

/** Ids of the plays with something to check. */
export function needsLook(flags: Map<string, QaFlag[]>): string[] {
  return [...flags.entries()].filter(([, list]) => list.some((f) => f.level === "check")).map(([id]) => id);
}

export interface FlagSummary {
  plays: number;
  needsLook: number;
  byCode: Partial<Record<QaFlag["code"], number>>;
}

export function summarizeFlags(cards: HudlPlayCard[], flags: Map<string, QaFlag[]>): FlagSummary {
  const byCode: FlagSummary["byCode"] = {};
  for (const list of flags.values()) for (const f of list) if (f.level === "check") byCode[f.code] = (byCode[f.code] ?? 0) + 1;
  return { plays: cards.length, needsLook: needsLook(flags).length, byCode };
}

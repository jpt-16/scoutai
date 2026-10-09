/**
 * Scout D alignment rules: every split receiver gets a defender leveraged
 * over him, the way a sound defense lines up against spread looks.
 *
 * 1. **Count split receivers per side** (not backs, not a tight end or wing
 *    attached to the box), numbered outside in: #1, #2, #3.
 * 2. **Corners** take the #1s (they're already drawn there).
 * 3. **Safety rotation**: on a side with 2+ split receivers the safety on that
 *    side walks down over the #2 (apexed between #2 and the next man inside in
 *    zone, head up with an inside shade in man) and the other safety goes to
 *    the middle of the field. Only one safety rolls, so there's always a deep
 *    man; a 2-high shell (`DEEP_SHELL`) keeps both deep instead.
 * 4. **Number matching**: any split receiver still uncovered (the other #2 in
 *    2x2, #3 in trips) gets the nearest backer on his side walked out of the
 *    box to apex him, as long as a backer stays in the box. Nobody stacks in
 *    the box while a receiver stands alone in space.
 *
 * The staff's own secondary for a formation (src/lib/secondary.ts) and a
 * coach's per-play drags (`defenseOverrides`) still win: with a table set the
 * DBs stay where it says and only the backers match numbers.
 *
 * Coordinates are the card's own un-flipped ones (offense view, defense above
 * the line at y < 140, before the hash shift). Framework-free; no imports from
 * formations.ts (which imports this).
 */

import type { DbAlignment, DbSlot } from "./secondary";

/** How the defenders over the slots play them. */
export type CoverageStyle = "MAN_OVER" | "ZONE_APEX" | "DEEP_SHELL";

/** A coach's per-play call on the secondary, saved on the card (`card.defenseAlignment`). */
export interface DefensiveAlignment {
  /** Where the safeties (FS and SS) line up, in yards off the line of scrimmage. */
  safetyDepthY?: number;
  /** The free safety (FS) on his own, in yards; wins over `safetyDepthY` for him. */
  freeDepthY?: number;
  /** The rover (SS) on his own, in yards; wins over `safetyDepthY` for him. */
  roverDepthY?: number;
  /** How the slots are played; defaults from the card's COVERAGE tag (`coverageStyleFor`). */
  coverageStyle?: CoverageStyle;
}

export const COVERAGE_STYLES: { value: CoverageStyle; label: string; detail: string }[] = [
  { value: "MAN_OVER", label: "Man over", detail: "Head up on the slots, one deep" },
  { value: "ZONE_APEX", label: "Apex", detail: "Split the slot and the box, one deep" },
  { value: "DEEP_SHELL", label: "2-high", detail: "Both safeties deep, backers apex" },
];

export const SAFETY_DEPTH_PRESETS: { label: string; yards: number; range: string }[] = [
  { label: "Press", yards: 4, range: "4 yds" },
  { label: "Normal", yards: 9, range: "8-10 yds" },
  { label: "Deep shell", yards: 13, range: "12-15 yds" },
];
export const MIN_SAFETY_DEPTH = 2;
export const MAX_SAFETY_DEPTH = 18;

const LOS_Y = 140;
const YARD_PX = 7;
const YARD_X = 500 / (160 / 3);
/** The tackles' x: the edge of the box before any tight end. */
const TACKLE_X = { left: 206, right: 294 } as const;
/** A tight end or wing within this of the box edge is attached, not split. */
const ATTACHED_PX = 3 * YARD_X;

const depthY = (yards: number) => LOS_Y - yards * YARD_PX;

/** Yards off the ball for each job (before a coach's safety depth). */
const DEPTH = {
  apexBacker: 6,
  overBacker: 5,
  apexSafety: 7,
  overSafety: 6,
  middle: 12,
} as const;

/**
 * The depth a coach set for one safety, in yards: his own number (free = FS,
 * rover = SS) before the one for both, else null (the alignment rules decide).
 */
export function safetyDepthFor(
  call: Pick<DefensiveAlignment, "safetyDepthY" | "freeDepthY" | "roverDepthY"> | undefined,
  label: string,
): number | null {
  if (label === "FS") return call?.freeDepthY ?? call?.safetyDepthY ?? null;
  if (label === "SS") return call?.roverDepthY ?? call?.safetyDepthY ?? null;
  return null;
}

export function clampSafetyDepth(yards: number): number {
  return Math.min(MAX_SAFETY_DEPTH, Math.max(MIN_SAFETY_DEPTH, Math.round(yards * 2) / 2));
}

/** Screen y for a safety depth (yards off the line), in un-flipped card coordinates. */
export function safetyY(yards: number): number {
  return depthY(clampSafetyDepth(yards));
}

/**
 * The style a Hudl COVERAGE tag implies: Cover 0 / 1 / man is man over, Cover
 * 2 / 4 / 6 / quarters / Tampa is a 2-high shell, Cover 3 (or nothing) apex.
 */
export function coverageStyleFor(coverage: string): CoverageStyle {
  const t = ` ${coverage.toUpperCase().replace(/[^A-Z0-9]+/g, " ")} `;
  if (/ (QUARTERS|QTRS|QUARTER|TAMPA|TWO HIGH|2 HIGH|SPLIT|HALVES) /.test(t)) return "DEEP_SHELL";
  const n = t.match(/ (?:COVER|CVR|CV|C)? ?([0-9]) /)?.[1] ?? t.match(/ C([0-9])/)?.[1];
  if (n === "2" || n === "4" || n === "6") return "DEEP_SHELL";
  if (n === "0" || n === "1") return "MAN_OVER";
  if (!n && / (MAN|PRESS|ZERO) /.test(t)) return "MAN_OVER";
  return "ZONE_APEX";
}

export interface AlignPlayer {
  label: string;
  x: number;
  y: number;
}

export interface AlignDefender extends AlignPlayer {
  /** Box linebacker (W, M, S, B) or secondary (C, FS, SS). Linemen never move. */
  group: "lb" | "db";
}

export interface SplitReceiver {
  label: string;
  x: number;
  side: "left" | "right";
  /** 1 = outermost. */
  number: number;
}

export interface Matchup {
  receiver: string;
  number: number;
  side: "left" | "right";
  /** Index into the defenders list, or -1 when nobody could be spared. */
  defender: number;
  how: "over" | "apex";
}

export interface AlignResult {
  /** Same order and labels as the input, moved. */
  defenders: AlignDefender[];
  receivers: SplitReceiver[];
  matchups: Matchup[];
  /** Split receivers nobody could be spared for. */
  uncovered: string[];
  /** Short lines for the card's NOTES box ("SS apex Y", "S apex H", "FS middle"). */
  notes: string[];
}

/**
 * Split receivers per side, numbered outside in. A player on the line (or a
 * wing just off it) within three yards of the box edge is attached: the box
 * edge moves out to him and he isn't split.
 */
export function splitReceivers(skill: AlignPlayer[]): SplitReceiver[] {
  const out: SplitReceiver[] = [];
  for (const side of ["left", "right"] as const) {
    const dir = side === "right" ? 1 : -1;
    const mine = skill
      .filter((p) => (p.x - 250) * dir > 0)
      .sort((a, b) => Math.abs(a.x - 250) - Math.abs(b.x - 250));
    let edge: number = TACKLE_X[side];
    const split: AlignPlayer[] = [];
    for (const p of mine) {
      const beyond = (p.x - edge) * dir;
      if (split.length === 0 && beyond <= ATTACHED_PX) {
        edge = Math.max(edge * dir, p.x * dir) * dir;
        continue;
      }
      split.push(p);
    }
    split
      .sort((a, b) => Math.abs(b.x - 250) - Math.abs(a.x - 250))
      .forEach((p, i) => out.push({ label: p.label, x: p.x, side, number: i + 1 }));
  }
  return out;
}

/** The box edge on a side: the tackle, or an attached tight end / wing outside him. */
function boxEdge(skill: AlignPlayer[], split: SplitReceiver[], side: "left" | "right"): number {
  const dir = side === "right" ? 1 : -1;
  const splitLabels = new Set(split.map((r) => r.label));
  let edge: number = TACKLE_X[side];
  for (const p of skill) {
    if (splitLabels.has(p.label) || (p.x - 250) * dir <= 0) continue;
    if ((p.x - edge) * dir > 0) edge = p.x;
  }
  return edge;
}

const sideOf = (x: number): "left" | "right" => (x >= 250 ? "right" : "left");

/**
 * Applies the rules to a drawn defense. `strongDir` breaks a tie in split
 * receivers (2x2) toward the formation's strength. With `table` (the staff's
 * secondary for this formation) the DBs don't move; its anchors say which
 * receivers they already cover.
 */
export function alignDefense({
  skill,
  defenders,
  strongDir,
  style,
  table,
}: {
  skill: AlignPlayer[];
  defenders: AlignDefender[];
  strongDir: 1 | -1;
  style: CoverageStyle;
  table?: DbAlignment;
}): AlignResult {
  const receivers = splitReceivers(skill);
  const moved = defenders.map((d) => ({ ...d }));
  const matchups: Matchup[] = [];
  const covered = new Set<string>();
  const used = new Set<number>();
  const notes: string[] = [];
  const tail: string[] = [];
  const count = (side: "left" | "right") => receivers.filter((r) => r.side === side).length;
  const strongSide: "left" | "right" =
    count("right") > count("left") ? "right" : count("left") > count("right") ? "left" : strongDir > 0 ? "right" : "left";
  const sides: ("left" | "right")[] = [strongSide, strongSide === "right" ? "left" : "right"];
  const onSide = (side: "left" | "right") => receivers.filter((r) => r.side === side);
  const edges = { left: boxEdge(skill, receivers, "left"), right: boxEdge(skill, receivers, "right") };

  /** Apex: halfway between the receiver and the next man inside (or the box edge). */
  const apexX = (r: SplitReceiver) => {
    const inside = onSide(r.side).find((o) => o.number === r.number + 1);
    return (r.x + (inside?.x ?? edges[r.side])) / 2;
  };
  const cover = (r: SplitReceiver, i: number, how: "over" | "apex", depthYards: number, move = true) => {
    const dir = r.side === "right" ? 1 : -1;
    if (move) {
      moved[i].x = how === "apex" ? apexX(r) : r.x - dir * YARD_X;
      moved[i].y = depthY(depthYards);
    }
    used.add(i);
    covered.add(r.label);
    matchups.push({ receiver: r.label, number: r.number, side: r.side, defender: i, how });
  };

  // Corners: over the #1s, already drawn there.
  const corners = moved.map((d, i) => ({ d, i })).filter(({ d }) => d.label === "C");
  const safeties = moved.map((d, i) => ({ d, i })).filter(({ d }) => d.label === "FS" || d.label === "SS");

  if (table) {
    // The staff's table: its anchors say who each DB is over.
    const strong = strongSide;
    const weak = strong === "right" ? "left" : "right";
    const slotOf = (d: AlignDefender): DbSlot | null =>
      d.label === "C" ? (sideOf(d.x) === strong ? "cs" : "cw") : d.label === "FS" ? "fs" : d.label === "SS" ? "ss" : null;
    for (const { d, i } of [...corners, ...safeties]) {
      const slot = slotOf(d);
      const spot = slot ? table[slot] : undefined;
      const anchor = spot ? Number(spot.anchor) : slot === "cs" || slot === "cw" ? 1 : NaN;
      if (!Number.isFinite(anchor)) continue;
      const side =
        slot === "cs" ? strong : slot === "cw" ? weak : (spot?.side ?? (slot === "ss" ? "strong" : "weak")) === "strong" ? strong : weak;
      const list = onSide(side);
      const r = list.find((o) => o.number === Math.min(anchor, list.length));
      if (r && !covered.has(r.label)) cover(r, i, "over", 0, false);
    }
  } else {
    for (const { d, i } of corners) {
      const r = onSide(sideOf(d.x)).find((o) => o.number === 1);
      if (r) cover(r, i, "over", 0, false);
    }
    // Safety rotation: the first side (strong first) with 2+ split receivers.
    const rollSide = style === "DEEP_SHELL" ? undefined : sides.find((s) => count(s) >= 2);
    if (rollSide && safeties.length) {
      const two = onSide(rollSide).find((r) => r.number === 2)!;
      const dir = rollSide === "right" ? 1 : -1;
      // The safety on that side rolls (SS to the strength); the other goes to the middle.
      const roller = [...safeties].sort((a, b) => (b.d.x - a.d.x) * dir)[0];
      const how = style === "MAN_OVER" ? "over" : "apex";
      cover(two, roller.i, how, how === "over" ? DEPTH.overSafety : DEPTH.apexSafety);
      notes.push(`${roller.d.label} ${how} ${two.label}`);
      for (const other of safeties) {
        if (other.i === roller.i) continue;
        moved[other.i].x = 250;
        moved[other.i].y = Math.min(moved[other.i].y, depthY(DEPTH.middle));
        tail.push(`${other.d.label} middle`);
      }
    }
  }

  // Number matching: walk a backer out to anyone still alone in space.
  for (const side of sides) {
    const dir = side === "right" ? 1 : -1;
    for (const r of onSide(side)) {
      if (covered.has(r.label)) continue;
      const inBox = moved
        .map((d, i) => ({ d, i }))
        .filter(({ d, i }) => d.group === "lb" && !used.has(i));
      if (inBox.length <= 1) {
        notes.push(`${r.label} uncovered`);
        continue;
      }
      // The backer furthest to that side goes; ties go to the one nearest the ball's depth.
      const backer = inBox.sort((a, b) => (b.d.x - a.d.x) * dir || b.d.y - a.d.y)[0];
      const how = style === "MAN_OVER" ? "over" : "apex";
      cover(r, backer.i, how, how === "over" ? DEPTH.overBacker : DEPTH.apexBacker);
      notes.push(`${backer.d.label} ${how} ${r.label}`);
    }
  }

  // A lone backer left in the box bumps over the ball.
  const inBox = moved.filter((d, i) => d.group === "lb" && !used.has(i));
  if (inBox.length === 1 && used.size > 0 && [...used].some((i) => moved[i].group === "lb")) inBox[0].x = 250;

  const uncovered = receivers.filter((r) => !covered.has(r.label)).map((r) => r.label);
  return { defenders: moved, receivers, matchups, uncovered, notes: [...notes, ...tail] };
}

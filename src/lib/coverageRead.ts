/**
 * The defense's coverage from film: what the corners, safeties and backers *do* in the first two seconds after the
 * snap, not where they stood before it (the pre-snap shell, `defenseRead.ts`, only narrows it: 2-high is Cover 2, 4, 6
 * or Tampa 2; 1-high is Cover 1 or 3; nobody deep is Cover 0, and a rotation at the snap changes all of it).
 *
 * Plain rules, thresholds at the top, in three questions:
 *
 *  1. **Man or zone.** A man defender moves with his receiver: from the snap on, his steps match the receiver's (a
 *     crossing route dragged him across the field) and he stays on him. A zone defender drops to a spot and lets a
 *     receiver run past or through him. Each underneath defender who had a receiver run a real route near him is
 *     one vote (`mirrors`); a defender nobody ran at says nothing.
 *  2. **How many deep** (at least `DEEP_YARDS` off the ball as the read ends, and in man, not running with a
 *     receiver): 0 is Cover 0, 1 Cover 1 in man; in zone, two with both corners sitting in the flats is Cover 2
 *     (Tampa 2 when the middle backer ran the deep middle), three is Cover 3, four is Cover 4. Two deep in man is
 *     2-Man. (There is no Cover 6 in this staff's calls: three deep with two of them on one side is still read as
 *     Cover 3, and marked unsure.)
 *  3. **The details a staff calls it by.** Who took each flat: a corner squatting is *cloud*, a safety rolling down
 *     *sky*, a backer *buzz*. In Cover 4, whether a safety carried a vertical #2 (**match**) or sat in his spot.
 *
 * Each answer carries the evidence for it and a confidence; `applyCoverageRead` writes a sure read on a card whose
 * sheet left COVERAGE blank (the coach's tag wins) and notes an unsure one for a coach to check. Tested on drawn plays
 * (`coverageRead.test.ts`); the two real test recordings can't be read (from the low sideline camera the defense isn't
 * followed through the play), so the real test is press-box film with the coverage tagged.
 */

import { deriveCard, type HudlPlayCard } from "./hudlParser";
import { matchFilmToCard, readDefense, type DefenseRead, type DefRole } from "./defenseRead";
import { isPressureTag } from "./pressure";
import { matchDetectedLetters, type DetectedPlayer } from "./videoImport";
import { snapTime, type TrackedPlayer, type TrackedPlayFile } from "./trackedPlay";

/** How long after the snap the read looks (the ball is usually out by then, and a man coverage has shown itself). */
const READ_SECONDS = 2.0;
/** Sample every this many seconds. */
const STEP_SECONDS = 0.1;
/** A man's position at a moment is taken from his track only if a point is this close in time (seconds). */
const NEAR_SECONDS = 0.25;
/** A defender has to be followed through this much of the read to count. */
const MIN_COVERAGE = 0.6;
/** Fewer than this many coverage defenders (not down linemen) followed through the read: no answer. */
const MIN_DEFENDERS = 6;

/** Deep: this many yards off the ball as the read ends. */
const DEEP_YARDS = 11;
/** A receiver who moved less than this hasn't run anything a defender could be seen covering. */
const ROUTE_YARDS = 6;
/** Mirroring is judged from this share of the read on (the cushion has closed by then), over steps this many samples long... */
const LATE_SHARE = 0.45;
const STEP_SAMPLES = 3;
/** ...where the defender's step and the receiver's differ by less than this (yards)... */
const MIRROR_YARDS = 0.6;
/** ...or this share of the receiver's step, whichever is more (a zone defender holding his spot as a route runs through scores 1)... */
const MIRROR_SHARE = 0.65;
/** ...and the defender stayed this close to him on average. */
const MAN_CLOSE_YARDS = 4.5;
/** A receiver who came this close to a defender at some point gave him the chance to show man or zone... */
const CHANCE_YARDS = 5;
/**
 * ...if his route went across the field this far: a man defender follows a break, a zone defender lets it go. A
 * vertical route says nothing (a Cover 3 corner bailing with a go route runs with him just like a man corner).
 */
const BREAK_YARDS = 3.5;
/** This share of the votes (or more) for man is a man coverage; this share or less is zone. */
const MAN_SHARE = 0.6;
const ZONE_SHARE = 0.4;
/** The flat: this far from the ball across the field, and no deeper than this. */
const FLAT_MIN_WIDTH = 7;
const FLAT_MAX_DEPTH = 8;
/** Three deep split in thirds when the smaller gap between them is at least this share of the larger. */
const THIRDS_RATIO = 0.6;
/** In Cover 4, a safety ending this close to a #2 who ran vertical (this far upfield) carried him: match. */
const MATCH_YARDS = 3;
const VERTICAL_YARDS = 10;
/** A defender who ended up this close to the line (or behind it) rushed the passer: no coverage to read from him. */
const RUSH_DEPTH = 1.5;
/** Deep zones: the middle one is within this many yards of the ball; a short zone inside this is a hook, outside it a curl. */
const DEEP_MIDDLE_WIDTH = 6;
const HOOK_WIDTH = 7;
/** Linemen and the quarterback, by where they stood: inside this half-width of the box, this close to the line. */
const BOX_HALF_WIDTH = 4;
const LINE_DEPTH = 1.6;

export type CoverageFamily = "0" | "1" | "2" | "2-man" | "tampa-2" | "3" | "4";
export type FlatPlayer = "cloud" | "sky" | "buzz" | "none";

/** What one defender was doing: covering a man, holding a zone, or rushing. */
export interface DefenderAssignment {
  /** Where he stood at the snap (yards from the ball), to find him again among the defense read's men. */
  start: { x: number; y: number };
  role: DefRole;
  kind: "man" | "zone" | "rush";
  /** Man: where the receiver he covered stood at the snap. */
  target?: { x: number; y: number };
  /** Zone: "FLAT", "HOOK", "CURL", "DEEP HALF", "DEEP THIRD", "DEEP QUARTER", "DEEP MIDDLE". */
  zone?: string;
}

export interface CoverageRead {
  family: CoverageFamily;
  /** The staff's tag, as the COVERAGE column would carry it: "COVER 3 SKY", "COVER 4 MATCH", "2 MAN", "TAMPA 2". */
  label: string;
  man: boolean;
  /** Defenders deep when the read ended. */
  deep: number;
  /** Who took the flat on each side (the offense's left, right). */
  flats: { left: FlatPlayer; right: FlatPlayer };
  /** Cover 4 only: a safety carried a vertical #2. */
  match?: boolean;
  /** The pre-snap shell, and whether the defense rotated out of it at the snap. */
  shell: "0-high" | "1-high" | "2-high" | null;
  rotated: boolean;
  /** 0-1: how cleanly the rules were met. */
  confidence: number;
  sure: boolean;
  /** What the answer rests on, a line each. */
  evidence: string[];
  /** Who each coverage defender covered or where he dropped, and who rushed. */
  assignments: DefenderAssignment[];
}

/** A read this unsure is noted for a coach, not written on the card. */
export const SURE_COVERAGE = 0.6;

type P = { x: number; y: number };

/** Where a man was at time t: interpolated between the track's points around it, if they are close enough in time. */
function at(track: TrackedPlayer, t: number): P | null {
  const pts = track.points;
  let before: [number, number, number] | null = null;
  let after: [number, number, number] | null = null;
  for (const p of pts) {
    if (p[0] <= t && (!before || p[0] > before[0])) before = p;
    if (p[0] >= t && (!after || p[0] < after[0])) after = p;
  }
  if (before && after && after[0] - before[0] <= 2 * NEAR_SECONDS) {
    const span = after[0] - before[0];
    const f = span > 0 ? (t - before[0]) / span : 0;
    return { x: before[1] + (after[1] - before[1]) * f, y: before[2] + (after[2] - before[2]) * f };
  }
  const near = [before, after].filter((p): p is [number, number, number] => !!p && Math.abs(p[0] - t) <= NEAR_SECONDS);
  return near.length ? { x: near[0][1], y: near[0][2] } : null;
}

interface Path {
  track: TrackedPlayer;
  /** Positions at the sample times (null where he wasn't seen). */
  samples: (P | null)[];
  start: P;
}

function pathOf(track: TrackedPlayer, times: number[]): Path | null {
  const samples = times.map((t) => at(track, t));
  const seen = samples.filter(Boolean).length;
  const start = samples[0] ?? samples.find((s): s is P => !!s);
  return start && seen >= MIN_COVERAGE * times.length ? { track, samples, start } : null;
}

const last = (p: Path) => [...p.samples].reverse().find((s): s is P => !!s)!;
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

/** How far a man got from his spot at the snap, at most. */
function moved(p: Path): number {
  return Math.max(0, ...p.samples.filter((s): s is P => !!s).map((s) => dist(s, p.start)));
}

/** How far across the field a man's route took him, at most. */
function across(p: Path): number {
  return Math.max(0, ...p.samples.filter((s): s is P => !!s).map((s) => Math.abs(s.x - p.start.x)));
}

/**
 * Whether defender d moved with receiver r: in the second half of the read (an off-man corner starts seven yards off
 * and closes the cushion first), his steps match r's step for step and he is on him.
 */
function mirrors(d: Path, r: Path): boolean {
  const from = Math.floor(d.samples.length * LATE_SHARE);
  let stepGap = 0;
  let stepSize = 0;
  let steps = 0;
  let close = 0;
  let n = 0;
  for (let i = from; i < d.samples.length; i++) {
    const a = d.samples[i];
    const b = r.samples[i];
    if (!a || !b) continue;
    close += dist(a, b);
    n++;
    const a0 = d.samples[i - STEP_SAMPLES];
    const b0 = r.samples[i - STEP_SAMPLES];
    if (i - STEP_SAMPLES < from || !a0 || !b0) continue;
    stepGap += Math.hypot(a.x - a0.x - (b.x - b0.x), a.y - a0.y - (b.y - b0.y));
    stepSize += dist(b, b0);
    steps++;
  }
  if (n < 3 || steps < 3) return false;
  return stepGap / steps < Math.max(MIRROR_YARDS, MIRROR_SHARE * (stepSize / steps)) && close / n < MAN_CLOSE_YARDS;
}

/** Whether receiver r came near defender d at some point (so d had the chance to show man or zone on him). */
function cameNear(d: Path, r: Path): boolean {
  return d.samples.some((a, i) => {
    const b = r.samples[i];
    return !!a && !!b && dist(a, b) < CHANCE_YARDS;
  });
}

const flatOf = (role: DefRole): FlatPlayer => (role === "cb" ? "cloud" : role === "s" || role === "nb" ? "sky" : role === "lb" ? "buzz" : "none");

/** The coverage, or null when too few defenders were followed through the play to say. */
export function readCoverage(file: TrackedPlayFile): CoverageRead | null {
  const snap = snapTime(file);
  const times = Array.from({ length: Math.round(READ_SECONDS / STEP_SECONDS) + 1 }, (_, i) => snap + i * STEP_SECONDS);
  const pre = readDefense(file);
  // Roles at the snap, from the defense read (which keeps each defender's snap spot as it was taken from his track).
  const roleOf = (track: TrackedPlayer, start: P): DefRole | null => {
    const hit = pre?.defenders
      .filter((d) => Math.hypot(d.x - start.x, d.y - start.y) < 1)
      .sort((a, b) => Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y))[0];
    if (hit) return hit.role;
    // Not in the defense read (it keeps eleven): place him by where he stood.
    if (start.y <= 2 && Math.abs(start.x) <= 7) return "dl";
    if (start.y >= 8) return "s";
    return Math.abs(start.x) > 6 ? "cb" : "lb";
  };
  const defense = file.tracks
    .filter((t) => t.team === "defense")
    .map((t) => pathOf(t, times))
    .filter((p): p is Path => !!p)
    .map((p) => ({ path: p, role: roleOf(p.track, p.start) }))
    .filter((d): d is { path: Path; role: DefRole } => d.role !== null && d.role !== "dl");
  if (defense.length < MIN_DEFENDERS) return null;
  const rushers = defense.filter(({ path: d }) => last(d).y < RUSH_DEPTH);
  const cover = defense.filter((d) => !rushers.includes(d));

  // Eligible receivers: every offensive man but the linemen and the quarterback.
  const offense = file.tracks
    .filter((t) => t.team === "offense")
    .map((t) => pathOf(t, times))
    .filter((p): p is Path => !!p);
  const linemen = offense.filter((p) => Math.abs(p.start.x) <= BOX_HALF_WIDTH && p.start.y > -LINE_DEPTH);
  const qb = offense
    .filter((p) => !linemen.includes(p) && Math.abs(p.start.x) <= 1.5 && p.start.y < -LINE_DEPTH)
    .sort((a, b) => Math.abs(a.start.x) - Math.abs(b.start.x))[0];
  const eligible = offense.filter((p) => !linemen.includes(p) && p !== qb);
  const runners = eligible.filter((r) => moved(r) >= ROUTE_YARDS);
  const breakers = runners.filter((r) => across(r) >= BREAK_YARDS);

  // 1. Man or zone: one vote per defender a route that broke across the field came near.
  const covering = new Map<Path, Path>();
  for (const { path: d } of cover) {
    const with_ = runners.find((r) => mirrors(d, r));
    if (with_) covering.set(d, with_);
  }
  let manVotes = 0;
  let zoneVotes = 0;
  for (const { path: d } of cover) {
    const near = breakers.filter((r) => cameNear(d, r));
    if (!near.length) continue;
    if (near.some((r) => mirrors(d, r))) manVotes++;
    else zoneVotes++;
  }
  const votes = manVotes + zoneVotes;
  const manShare = votes ? manVotes / votes : 0.5;
  const man = manShare >= MAN_SHARE;

  // 2. Deep: off the ball as the read ends; in man, not a defender running with his receiver.
  const deep = defense.filter(({ path: d }) => last(d).y >= DEEP_YARDS && !(man && covering.has(d)));
  const deepXs = deep.map(({ path: d }) => last(d).x).sort((a, b) => a - b);
  const corners = defense.filter((d) => d.role === "cb");
  const shallowCorners = corners.filter(({ path: d }) => last(d).y < DEEP_YARDS);

  // 3. Who took each flat.
  const flatPlayer = (side: -1 | 1): FlatPlayer => {
    const inFlat = defense
      .filter(({ path: d }) => {
        const e = last(d);
        return e.x * side >= FLAT_MIN_WIDTH && e.y <= FLAT_MAX_DEPTH && !(man && covering.has(d));
      })
      .sort((a, b) => last(b.path).x * side - last(a.path).x * side);
    return inFlat.length ? flatOf(inFlat[0].role) : "none";
  };
  const flats = { left: flatPlayer(-1), right: flatPlayer(1) };

  const evidence: string[] = [];
  evidence.push(votes ? `${manVotes} of ${votes} defenders a route came near ran with him` : "no route broke across a defender");
  if (rushers.length) evidence.push(`${rushers.length} rushed besides the line`);
  evidence.push(`${deep.length} deep at ${READ_SECONDS} s (${deep.map((d) => d.role.toUpperCase()).join(", ") || "none"})`);
  let confidence = 1;
  if (defense.length < 8) confidence -= 0.15;
  if (votes === 0) confidence -= 0.4;
  else if (votes < 2) confidence -= 0.3;
  else if (manShare > ZONE_SHARE && manShare < MAN_SHARE) confidence -= 0.35;
  // The defense at the snap has to add up (on the low sideline recordings it read "3-1-7": the line hidden, the sideline
  // creeping in), and no defense plays five deep: either way the men being read aren't the defense's eleven.
  if (!pre?.plausible) {
    confidence -= 0.5;
    evidence.push(`the defense at the snap doesn't add up (${pre ? pre.label : "not read"})`);
  }
  if (deep.length > 4) confidence -= 0.5;

  let family: CoverageFamily;
  let match: boolean | undefined;
  if (man) {
    family = deep.length === 0 ? "0" : deep.length === 1 ? "1" : "2-man";
    if (deep.length > 2) confidence -= 0.3;
  } else if (deep.length >= 4) {
    family = "4";
    // Match: a safety carried a #2 who went vertical.
    const twos = eligible.filter((r) => last(r).y - r.start.y >= VERTICAL_YARDS && Math.abs(r.start.x) < Math.max(...eligible.map((e) => Math.abs(e.start.x))));
    const safeties = deep.filter((d) => d.role === "s");
    if (twos.length && safeties.length) {
      match = twos.some((r) => safeties.some(({ path: s }) => dist(last(s), last(r)) <= MATCH_YARDS));
      evidence.push(match ? "a safety carried the vertical #2" : "the safeties let the vertical #2 go to the next man");
    }
  } else if (deep.length === 3) {
    const middleLb = deep.find((d) => d.role === "lb");
    const gaps = [deepXs[1] - deepXs[0], deepXs[2] - deepXs[1]];
    const thirds = Math.min(...gaps) >= THIRDS_RATIO * Math.max(...gaps);
    if (middleLb && shallowCorners.length >= 2) {
      family = "tampa-2";
      evidence.push("the middle backer ran the deep middle; both corners sat in the flats");
    } else {
      family = "3";
      if (thirds) evidence.push("three deep, splitting the field in thirds");
      else {
        // Not thirds: two of the three deep on one side. Not a call this staff uses, so a man may have been misread.
        confidence -= 0.3;
        evidence.push("three deep, but two of them on one side rather than in thirds");
      }
    }
  } else if (deep.length === 2) {
    family = "2";
    if (shallowCorners.length < 2) {
      confidence -= 0.3;
      evidence.push("two deep but a corner didn't sit in the flat (a deep man not followed?)");
    } else evidence.push("two deep halves; both corners sat in the flats");
  } else {
    // One deep and zone: Cover 3 with two of the deep men lost, or a robber look. Say Cover 3, unsure.
    family = "3";
    confidence -= 0.4;
    evidence.push(`only ${deep.length} deep in a zone: two deep men may not have been followed`);
  }

  const shell = pre?.shell ?? null;
  const highAfter = family === "2" || family === "2-man" || family === "4" || family === "tampa-2" ? 2 : family === "0" ? 0 : 1;
  const rotated = !!shell && shell !== `${highAfter}-high`;
  if (rotated) evidence.push(`${shell} before the snap, rotated at the snap`);

  const flatTag = (["left", "right"] as const).map((s) => flats[s]).find((f) => f !== "none" && f !== "cloud") ?? (flats.left === "cloud" || flats.right === "cloud" ? "cloud" : "none");
  const label =
    family === "0" ? "COVER 0"
    : family === "1" ? "COVER 1"
    : family === "2-man" ? "2 MAN"
    : family === "tampa-2" ? "TAMPA 2"
    : family === "2" ? "COVER 2"
    : family === "4" ? (match ? "COVER 4 MATCH" : "COVER 4")
    : `COVER 3${flatTag === "none" ? "" : ` ${flatTag.toUpperCase()}`}`;
  confidence = Math.max(0, Math.min(1, confidence));
  // Who has whom: a man defender his receiver; a zone defender the area he ended in; a rusher the quarterback.
  const zoneName = (e: P, role: DefRole): string => {
    if (e.y >= DEEP_YARDS) {
      if (family === "2" || family === "2-man" || family === "tampa-2") return role === "lb" ? "DEEP MIDDLE" : "DEEP HALF";
      if (family === "4") return "DEEP QUARTER";
      if (family === "1") return "DEEP MIDDLE";
      return Math.abs(e.x) < DEEP_MIDDLE_WIDTH ? "DEEP MIDDLE" : "DEEP THIRD";
    }
    if (Math.abs(e.x) >= FLAT_MIN_WIDTH && e.y <= FLAT_MAX_DEPTH) return "FLAT";
    return Math.abs(e.x) < HOOK_WIDTH ? "HOOK" : "CURL";
  };
  const assignments: DefenderAssignment[] = [
    ...rushers.map(({ path: d, role }): DefenderAssignment => ({ start: d.start, role, kind: "rush" })),
    ...cover.flatMap(({ path: d, role }): DefenderAssignment[] => {
      const receiver = man ? covering.get(d) : undefined;
      if (receiver) return [{ start: d.start, role, kind: "man", target: receiver.start }];
      if (man && last(d).y < DEEP_YARDS) return []; // a man defender who had no one to follow: no assignment to say
      return [{ start: d.start, role, kind: "zone", zone: zoneName(last(d), role) }];
    }),
  ];
  return { family, label, man, deep: deep.length, flats, match, shell, rotated, confidence, sure: confidence >= SURE_COVERAGE, evidence, assignments };
}

/**
 * The coverage family a COVERAGE tag names ("C3", "Cover 3 Sky", "Quarters", "Tampa"), for scoring against a sheet. A
 * number this staff doesn't use as a coverage (no Cover 5 or 6; their sheets also carry calls like "6 - DOUBLE FIRE")
 * names none.
 */
export function coverageFamilyOf(tag: string): CoverageFamily | null {
  const t = ` ${tag.toUpperCase().replace(/[^A-Z0-9]+/g, " ")} `;
  if (/ TAMPA /.test(t)) return "tampa-2";
  if (/ (QUARTERS|QTRS|QUARTER) /.test(t)) return "4";
  if (/ (2 MAN|TWO MAN|COVER 5|C5) /.test(t)) return "2-man";
  const n = t.match(/ (?:COVER|CVR|CV|C)? ?([0-9]) /)?.[1] ?? t.match(/ C([0-9])/)?.[1];
  if (n === "0" || n === "1" || n === "2" || n === "3" || n === "4") return n;
  if (/ (ZERO) /.test(t)) return "0";
  return null;
}

/**
 * A card with the film's coverage: written when the sheet left COVERAGE blank and the read is sure (the coach's tag
 * always wins), noted either way so a coach can see what the film said.
 */
export function applyCoverageRead(card: HudlPlayCard, read: CoverageRead | null, defense?: DefenseRead | null): HudlPlayCard {
  if (!read) return card;
  const note = read.sure ? `Film coverage: ${read.label}.` : `Check coverage: film says ${read.label}, unsure.`;
  const notes = [card.notes, note].filter(Boolean).join(" ");
  const coverage = !card.coverage.trim() && read.sure ? read.label : card.coverage;
  // Who covered whom / where each dropped: written only on a sure read of a defense that adds up, and where the sheet's COVERAGE is
  // blank or a blitz call (a coach's own coverage tag could contradict the film's, so it keeps the column to itself).
  const assign = read.sure && defense?.plausible && (!card.coverage.trim() || isPressureTag(card.coverage));
  const defenseAssignments = assign ? defenseAssignmentsFor(card, defense!, read) : undefined;
  return deriveCard({ ...card, coverage, notes, ...(defenseAssignments && Object.keys(defenseAssignments).length ? { defenseAssignments } : {}) });
}

/**
 * What each defender was doing, in words for the card, keyed by the card's own defender id: "→ X" for the receiver he
 * covered (the card's own letter for him), a zone ("FLAT", "DEEP THIRD", "HOOK"), or "RUSH". Only men the defense read
 * placed on the card.
 */
export function defenseAssignmentsFor(card: HudlPlayCard, defense: DefenseRead, read: CoverageRead): Record<string, string> {
  // The receivers covered, put on the card's own letters by where they lined up (like a film card's routes).
  const targets = read.assignments.flatMap((a) => (a.target ? [a.target] : []));
  const players: DetectedPlayer[] = targets.map((t) => ({ label: "?", start: t, waypoints: [], endpoint: t }));
  const letters = players.length ? matchDetectedLetters({ playName: "", formation: "", units: "yards", players }, card) : new Map();
  const letterOf = new Map(targets.map((t, i) => [t, letters.get(players[i])] as const));
  const ids = matchFilmToCard(card, defense);
  const out: Record<string, string> = {};
  for (const a of read.assignments) {
    const index = defense.defenders.findIndex((d) => Math.hypot(d.x - a.start.x, d.y - a.start.y) < 1);
    const id = [...ids].find(([, i]) => i === index)?.[0];
    if (!id) continue;
    if (a.kind === "rush") out[id] = "RUSH";
    else if (a.kind === "zone" && a.zone) out[id] = a.zone;
    else if (a.target && letterOf.get(a.target)) out[id] = `→ ${letterOf.get(a.target)}`;
  }
  return out;
}

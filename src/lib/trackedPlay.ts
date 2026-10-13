/**
 * From a tracked play to a scout card.
 *
 * `video-service/eval/tracks.py` follows every player through a play and writes where each
 * one went, in yards from the ball at the snap (x to the offense's right, y upfield). This
 * turns that file into the same `DetectedPlay` the film AI produces, so the card is drawn by
 * the code that already draws film cards (`buildCardFromDetection`, or `applyDetectionToCard`
 * onto a Hudl sheet's row): the same letters, the same draggable arrows, the same table.
 *
 * What is different from the AI path is who names the route. Here `readRoute` does, from the
 * path itself, and says how sure it is, so a play it can't call is marked on the card for a
 * coach instead of being drawn confidently wrong.
 *
 * Framework-free, so Vitest and the Node script run it directly.
 */

import type { RouteKind } from "./formations";
import { deriveCard, type HudlPlayCard } from "./hudlParser";
import { readRoute } from "./routeReader";
import {
  applyDetectionToCard,
  buildCardFromDetection,
  matchDetectedLetters,
  type DetectedPlay,
  type DetectedPlayer,
} from "./videoImport";

/** One followed player, as `eval/tracks.py` writes him. */
export interface TrackedPlayer {
  id: number;
  team: "offense" | "defense";
  /** Yards from the ball at the snap. */
  start: [number, number];
  /** Seconds after the snap, then x, y in yards. */
  points: [number, number, number][];
}

/** The offense's formation as `eval.tracks.formation_reads` named it: from the tracks (the staff's own name where it has one). */
export interface FilmFormation {
  key: string;
  strength: string | null;
  staff: string;
  /** What a card's formation column would say ("deuces gun", "trio gun right", "trips right"); "" when it couldn't be read. */
  text: string;
  notes: string;
  men: number;
}

export interface TrackedPlayFile {
  fps?: number;
  /** The formation as the clip first shows it and at the snap: they differ when a man went in motion (Bunch, then a receiver zaps across: Deuces). */
  formations?: { set: FilmFormation; snap: FilmFormation; snapSeconds: number };
  /** The team being scouted (its jersey color) and which side of the ball it was on in this play (`eval/scoutteam.py`). */
  scout?: { color: string; side: "offense" | "defense" | null };
  tracks: TrackedPlayer[];
}

/** A lineman: on the line and inside the box. Skill players are everyone else on offense. */
const ON_LINE_MIN_Y = -1.4;
const BOX_HALF_WIDTH_YARDS = 3.5;
/** A man on the line who got this far from his spot (or further) in the first seconds was a receiver, not a lineman. */
const LINEMAN_MAX_TRAVEL_YARDS = 6;
const LINEMAN_WINDOW_SECONDS = 4;
/** The quarterback is the man nearest the ball behind the center. */
const QB_MAX_ACROSS_YARDS = 2.5;
/** He stands at least this far behind the line's depth (a guard a yard off the ball does not). */
const QB_BEHIND_LINE_YARDS = 0.8;
/** A read this unsure (margin over the runner-up) is flagged for a coach. */
export const SURE_CONFIDENCE = 0.25;

/**
 * Whether a route read from film may be drawn on a card as the play's route. **Off until it's proven**: on the first real plays scored against
 * what the coach says each man ran, the reader was right on 2 of 13 routes (the tracks, not the reader, are the limit) and its confidence did not
 * separate the right reads from the wrong ones, so a film route can't be told from a wrong one by the card. Off, a card built with the staff's
 * sheet keeps the sheet's call (the coach's own tags) and lists what the film saw in its notes, and a film-only card draws the read but says
 * every route is unchecked. Turn it on per run (`--trust-film-routes`) once `scripts/score-truth.ts` shows it right on a real set of plays.
 */
export const FILM_ROUTES_PROVEN = false;
/** The snap is when this many offensive men have all started to move: a man or two in motion before it do not count. */
const SNAP_MOVERS = 4;
const MOVED_YARDS = 1.5;
/** Take the snap a little before the third man's move shows. */
const SNAP_LEAD_SECONDS = 0.35;
/** A route is read only from a track followed at least this long after the snap. */
const MIN_TRACK_SECONDS = 2;
const ONSET_STARTERS = 3;
/** From both teams together. */
const ONSET_COMBINED_STARTERS = 6;
const ONSET_WINDOW_SECONDS = 0.6;
const ONSET_STEP_SECONDS = 0.1;
const ONSET_STILL_YARDS = 0.6;
const ONSET_GO_YARDS = 1.2;
const ONSET_SPREAD_SECONDS = 0.5;
const ONSET_LEAD_SECONDS = 0.1;
/** The onset replaces the older rule only when it is later by this much: a clean play has both within a tenth of a second, and a formation shifting before the ball moves fools the older rule by a second. */
const ONSET_OVERRIDE_SECONDS = 0.3;
const ONSET_LEFT_YARDS = 0.5;
const ONSET_NEAR_SECONDS = 0.12;

/**
 * Far faster than any high-school player runs, with room for detection noise on top of a sprint (a real
 * sprint reads up to ~15 yd/s over a short window; the tracker sliding onto the bench reads over 60): a
 * bigger jump is the tracker changing men.
 */
const MAX_YARDS_PER_SECOND = 24;
/** Across a gap in a track (the man was missed), how far he can have gone: slack plus a runner's speed. */
const GAP_SECONDS = 0.15;
const GAP_SLACK_YARDS = 1.5;
const GAP_YARDS_PER_SECOND = 9;
/** Compare points at least this far apart in time, so a frame of jitter doesn't look like a jump. */
const JUMP_WINDOW_SECONDS = 0.3;
/** Two tracks starting this close are one man followed twice. */
const SAME_MAN_YARDS = 2;
/** The shortest route in the tree runs about this far; less than that hasn't shown which route it is. */
const MIN_ROUTE_YARDS = 4;
/**
 * A route is what he ran before the ball got there: read his first this-many seconds from the snap. After that it is
 * the run after the catch or a receiver giving up on a route (on real film a hitch, settled at 2 s and then run 6 yards
 * upfield and out over the next 3, read as an OUT). Deep routes at a high-school receiver's speed (about 7 yd/s) need about
 * this long to show (a comeback's 16-yard stem is 2.3 s), so a quick hitch caught and run with inside 3 s can still
 * misread: the window is a ceiling, not the moment of the catch, which the tracks don't show.
 */
export const ROUTE_SECONDS = 3;

/** A man who moved this far (yards) between where he was set and where he stood at the snap went in motion. */
export const MOTION_MIN_YARDS = 2.5;
/** Pre-snap film needed to tell: this many seconds before the snap, and this many points of the man in it. */
const MOTION_MIN_SECONDS = 0.5;
const MOTION_MIN_POINTS = 6;
/** He is "set" at the mean of his first points and "at the snap" at the mean of his last, so a box's jitter isn't motion. */
const MOTION_AVERAGE_POINTS = 4;
/** Nobody runs faster than this (yards a second, over 0.3 s) before the snap: a track that did slid onto another man. */
const MOTION_MAX_YARDS_PER_SECOND = 14;
const MOTION_WINDOW_SECONDS = 0.3;

/**
 * Where a man was set before he went in motion, or null if he didn't. The track file starts a few seconds before the snap
 * (the calibrated frame), when everyone is still; a man who is somewhere else by the snap, further than a box's jitter,
 * went there. `fromTheSnap` cuts everything before the snap, so this reads the whole track.
 */
export function motionFromTrack(track: TrackedPlayer, snap: number): { x: number; y: number } | null {
  if (snap < MOTION_MIN_SECONDS) return null;
  const before = track.points.filter(([s]) => s <= snap);
  if (before.length < MOTION_MIN_POINTS || before[0][0] > snap - MOTION_MIN_SECONDS) return null;
  const mean = (pts: [number, number, number][]) => ({
    x: pts.reduce((a, p) => a + p[1], 0) / pts.length,
    y: pts.reduce((a, p) => a + p[2], 0) / pts.length,
  });
  const set = mean(before.slice(0, MOTION_AVERAGE_POINTS));
  const end = mean(before.slice(-MOTION_AVERAGE_POINTS));
  const moved = Math.hypot(end.x - set.x, end.y - set.y);
  if (moved < MOTION_MIN_YARDS) return null;
  for (let i = 1, j = 0; i < before.length; i++) {
    while (j < i - 1 && before[i][0] - before[j + 1][0] >= MOTION_WINDOW_SECONDS) j++;
    const dt = before[i][0] - before[j][0];
    if (dt >= MOTION_WINDOW_SECONDS && Math.hypot(before[i][1] - before[j][1], before[i][2] - before[j][2]) / dt > MOTION_MAX_YARDS_PER_SECOND) return null;
  }
  return { x: Math.round(set.x * 10) / 10, y: Math.round(set.y * 10) / 10 };
}

type ReadKind = RouteKind | "block" | "unknown";

/**
 * The part of a track before the tracker jumped to another man: a move faster than anyone can
 * run, over a short window, means the track was handed to someone else. What came after belongs
 * to him, not to this receiver, so it is cut off rather than read as a route.
 */
export function trimAtJump(points: [number, number, number][]): [number, number, number][] {
  for (let i = 1; i < points.length; i++) {
    // A track missing for a while and found again far away: a runner covers about 9 yd/s, plus the detector's jitter.
    const missed = points[i][0] - points[i - 1][0];
    if (missed > GAP_SECONDS && Math.hypot(points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]) > GAP_SLACK_YARDS + GAP_YARDS_PER_SECOND * missed) {
      return points.slice(0, i);
    }
    let j = i - 1;
    while (j > 0 && points[i][0] - points[j][0] < JUMP_WINDOW_SECONDS) j -= 1;
    const dt = points[i][0] - points[j][0];
    if (dt <= 0) continue;
    const gap = Math.hypot(points[i][1] - points[j][1], points[i][2] - points[j][2]);
    if (gap / Math.max(dt, JUMP_WINDOW_SECONDS) > MAX_YARDS_PER_SECOND) return points.slice(0, i);
  }
  return points;
}

/** How far upfield a track got: a receiver running a route reaches yards a man standing or drifting along the line never does. */
function reach(t: TrackedPlayer): number {
  return t.points.reduce((m, [, , y]) => Math.max(m, y), 0);
}

/**
 * One man followed twice (two ids that start on the same spot) counts once. Of the two, the one that got
 * furthest upfield: the other is usually a track that wandered off after a bystander, and it can be the longer.
 */
function dropSameMan(tracks: TrackedPlayer[]): TrackedPlayer[] {
  const longest = [...tracks].sort((a, b) => reach(b) - reach(a) || b.points.length - a.points.length);
  const kept: TrackedPlayer[] = [];
  for (const t of longest) {
    if (kept.some((k) => Math.hypot(k.start[0] - t.start[0], k.start[1] - t.start[1]) < SAME_MAN_YARDS)) continue;
    kept.push(t);
  }
  return tracks.filter((t) => kept.includes(t));
}

function pathLength(points: [number, number, number][]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]);
  }
  return total;
}

export interface TrackedRead {
  /** The card's letter he was matched to. */
  letter: string;
  kind: ReadKind;
  confidence: number;
  runnerUp?: RouteKind;
}

interface RawRead {
  player: DetectedPlayer;
  kind: ReadKind;
  confidence: number;
  runnerUp?: RouteKind;
}

/**
 * When the ball was snapped, from the tracks: the time the fourth offensive man to move more than a
 * yard from his spot started to. A track file starts at a calibrated frame that can be seconds before the snap
 * (the players are set, one may be in motion), and a route is read from the snap on. 0 if too few moved.
 */
export function snapTime(file: TrackedPlayFile): number {
  const older = firstMoversSnap(file);
  const onset = onsetSnap(file);
  return onset !== null && onset - older > ONSET_OVERRIDE_SECONDS ? onset : older;
}

/** The older rule: the fourth offensive man to get 1.5 yd from his first spot, less a beat. Drifting men and one in motion count. */
function firstMoversSnap(file: TrackedPlayFile): number {
  const times = file.tracks
    .filter((t) => t.team === "offense" && t.points.length >= 2)
    .map((t) => {
      const [, x0, y0] = t.points[0];
      return t.points.find(([, x, y]) => Math.hypot(x - x0, y - y0) > MOVED_YARDS)?.[0];
    })
    .filter((v): v is number => v !== undefined)
    .sort((a, b) => a - b);
  return times.length >= SNAP_MOVERS ? Math.max(0, times[SNAP_MOVERS - 1] - SNAP_LEAD_SECONDS) : 0;
}

/** Where a track was at time `s` (the nearest point within a few frames), or null. */
function spotAt(t: TrackedPlayer, s: number): [number, number] | null {
  let best: [number, number, number] | null = null;
  for (const p of t.points) if (!best || Math.abs(p[0] - s) < Math.abs(best[0] - s)) best = p;
  return best && Math.abs(best[0] - s) <= ONSET_NEAR_SECONDS ? [best[1], best[2]] : null;
}

/**
 * The snap as an *onset*: men who were standing and then all start at once. A man starts when he moved under `ONSET_STILL_YARDS`
 * in the 0.6 s before a moment and over `ONSET_GO_YARDS` in the 0.6 s after; the snap is the first moment from which
 * `ONSET_STARTERS` men start within half a second. A man in motion starts once and a man drifting or shuffling in his stance
 * rarely gets 1.2 yd in 0.6 s from a standstill, so unlike "the fourth man to leave his spot" the formation shifting before the
 * snap doesn't set it off (first real film: that rule fired 0.85 s early on a Bunch zapped to Deuces). Null when too few start.
 */
function onsetSnap(file: TrackedPlayFile): number | null {
  const all = file.tracks.filter((t) => t.points.length >= 8);
  if (!all.length) return null;
  const first = Math.min(...all.map((t) => t.points[0][0]));
  const last = Math.max(...all.map((t) => t.points[t.points.length - 1][0]));
  const onsetsOf = (team: string): number[] => {
    const out: number[] = [];
    for (const t of all.filter((tr) => tr.team === team)) {
      for (let s = first + ONSET_WINDOW_SECONDS; s <= last - ONSET_WINDOW_SECONDS; s += ONSET_STEP_SECONDS) {
        const a = spotAt(t, s - ONSET_WINDOW_SECONDS);
        const b = spotAt(t, s);
        const c = spotAt(t, s + ONSET_WINDOW_SECONDS);
        if (!a || !b || !c) continue;
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < ONSET_STILL_YARDS && Math.hypot(c[0] - b[0], c[1] - b[1]) > ONSET_GO_YARDS) {
          // The forward window sees a start up to 0.6 s early: the onset is when he got 0.5 yd from where he stood.
          const left = t.points.find(([u, x, y]) => u >= s && Math.hypot(x - b[0], y - b[1]) > ONSET_LEFT_YARDS);
          out.push(left ? left[0] : s);
          break;
        }
      }
    }
    return out.sort((x, y) => x - y);
  };
  const offense = onsetsOf("offense");
  const defense = onsetsOf("defense");
  // Both teams move at the snap, and only then: a formation shifting, a man in motion or tracker jitter start two or three offensive men
  // early (real play 43: three at 1.0 s, the snap at 4.4), but not the defense too. So the densest cluster of starts from the two teams
  // together, at least `ONSET_COMBINED_STARTERS` of them, is the snap.
  const together = [...offense, ...defense].sort((x, y) => x - y);
  let best = -1;
  let bestCount = 0;
  for (let i = 0; i < together.length; i++) {
    const count = together.filter((v) => v >= together[i] && v - together[i] <= ONSET_SPREAD_SECONDS).length;
    if (count >= ONSET_COMBINED_STARTERS && count >= bestCount) {
      best = i;
      bestCount = count;
    }
  }
  if (best >= 0) return Math.max(0, together[best] - ONSET_LEAD_SECONDS);
  // Too few defenders were followed: the offense alone, three men starting together.
  for (let i = 0; i + ONSET_STARTERS <= offense.length; i++) {
    if (offense[i + ONSET_STARTERS - 1] - offense[i] <= ONSET_SPREAD_SECONDS) return Math.max(0, offense[i] - ONSET_LEAD_SECONDS);
  }
  return null;
}

/** The same tracks with everything before the snap cut off: each man starts where he stood at the snap. */
export function fromTheSnap(file: TrackedPlayFile): TrackedPlayFile {
  const at = snapTime(file);
  if (at <= 0) return file;
  return {
    ...file,
    tracks: file.tracks.flatMap((t) => {
      const points = t.points.filter(([s]) => s >= at);
      if (points.length < 2) return t.team === "offense" ? [] : [];
      return [{ ...t, start: [points[0][1], points[0][2]] as [number, number], points }];
    }),
  };
}

const routeName = (kind: string) => kind.replace(/-/g, " ").toUpperCase();

/** Where the line's front is: men this far back or deeper are not on it. */
function lineCutoff(offense: TrackedPlayer[]): number {
  const box = offense.filter((t) => Math.abs(t.start[0]) <= BOX_HALF_WIDTH_YARDS && t.start[1] > -1.5).map((t) => t.start[1]).sort((a, b) => a - b);
  const lineY = box.length >= 3 ? box[Math.floor(box.length / 2)] : 0;
  return Math.min(ON_LINE_MIN_Y, lineY - QB_BEHIND_LINE_YARDS);
}

/** A lineman: on the line, inside the box, and he never ran off like a receiver. */
function isLineman(t: TrackedPlayer, cutoff: number): boolean {
  if (t.start[1] < cutoff || Math.abs(t.start[0]) > BOX_HALF_WIDTH_YARDS) return false;
  // Tracker jitter adds yards to a path that goes nowhere, so how far he got from his spot is measured, over the first seconds.
  const early = t.points.filter(([s]) => s <= t.points[0][0] + LINEMAN_WINDOW_SECONDS);
  return Math.max(...early.map(([, x, y]) => Math.hypot(x - t.start[0], y - t.start[1]))) < LINEMAN_MAX_TRAVEL_YARDS;
}

/**
 * The quarterback among the offense: the man behind the line, directly behind the center. The
 * line's depth is measured from the men in the box, since the center and guards sit a yard or so
 * off the ball in a track and would otherwise pass for a quarterback.
 */
function pickQuarterback(offense: TrackedPlayer[]): TrackedPlayer | undefined {
  const cutoff = lineCutoff(offense);
  return offense
    .filter((t) => t.start[1] < cutoff && Math.abs(t.start[0]) <= QB_MAX_ACROSS_YARDS)
    .sort((a, b) => Math.abs(a.start[0]) - Math.abs(b.start[0]) || b.start[1] - a.start[1])[0];
}

/**
 * The detection for a tracked play, in yards. Each skill player's route is named by
 * `readRoute` (stored as `routeType`, so the card snaps it to the staff's own technique); a
 * man it can't call keeps his own path with no name. The quarterback is `Q` and gets no route.
 * `reads` holds what the reader said about each skill player.
 */
export function detectionFromTracks(
  file: TrackedPlayFile,
  opts: { formation?: string; playName?: string } = {},
): { detection: DetectedPlay; reads: RawRead[] } {
  const snap = snapTime(file);
  const followed = fromTheSnap(file).tracks.filter((t) => t.team === "offense" && t.points.length >= 2);
  const qb = pickQuarterback(followed);
  const cutoff = lineCutoff(followed);
  // Everyone but the quarterback is read only up to where his track jumped to another man. Linemen stand a
  // yard apart, so the one-man-twice check is made among the skill players only.
  const trimmed = followed
    .map((t) => (qb && t.id === qb.id ? t : { ...t, points: trimAtJump(t.points) }))
    .filter((t) => t.points.length >= 2);
  const offense = [
    ...trimmed.filter((t) => (qb && t.id === qb.id) || isLineman(t, cutoff)),
    ...dropSameMan(trimmed.filter((t) => !(qb && t.id === qb.id) && !isLineman(t, cutoff))),
  ];
  const players: DetectedPlayer[] = [];
  const reads: RawRead[] = [];

  for (const t of offense) {
    const start = { x: t.start[0], y: t.start[1] };
    if (qb && t.id === qb.id) {
      players.push({ label: "Q", start, waypoints: [], endpoint: start, routeType: "NONE" });
      continue;
    }
    if (isLineman(t, cutoff)) continue;
    const route = t.points.filter(([s]) => s <= t.points[0][0] + ROUTE_SECONDS);
    const path = route.map(([, x, y]) => ({ x, y }));
    const raw = readRoute(path, t.start[0] < 0 ? -1 : 1);
    // A path cut short (lost, or handed to another man) hasn't shown which route it was.
    // A track that ends before the route can show itself says nothing, not even "he blocked": real play 43 read two receivers as
    // blocking at full confidence because their tracks were lost a second after the snap.
    const seen = route.length ? route[route.length - 1][0] - route[0][0] : 0;
    const read =
      seen < MIN_TRACK_SECONDS || (raw.kind !== "block" && pathLength(route) < MIN_ROUTE_YARDS)
        ? { ...raw, kind: "unknown" as const, confidence: 0 }
        : raw;
    const motion = motionFromTrack(file.tracks.find((o) => o.id === t.id) ?? t, snap);
    const player: DetectedPlayer = {
      label: "?",
      start,
      ...(motion ? { motionFrom: motion } : {}),
      waypoints: path.slice(1, -1),
      endpoint: path[path.length - 1],
      ...(read.kind === "unknown" ? {} : { routeType: routeName(read.kind) }),
    };
    players.push(player);
    reads.push({ player, kind: read.kind, confidence: read.confidence, runnerUp: read.ranked[1]?.kind });
  }

  return {
    detection: { playName: opts.playName ?? "", formation: opts.formation ?? "", players, units: "yards" },
    reads,
  };
}

/** "Check routes: H (curl or hitch)" for the plays the reader wasn't sure of. */
function checkNote(unsure: TrackedRead[]): string {
  const parts = unsure.map((r) =>
    r.kind === "unknown"
      ? `${r.letter} (unclear)`
      : `${r.letter} (${routeName(r.kind).toLowerCase()}${r.runnerUp ? ` or ${routeName(r.runnerUp).toLowerCase()}` : ""})`,
  );
  return `Check routes: ${parts.join(", ")}`;
}

export interface TrackedCard {
  card: HudlPlayCard;
  reads: TrackedRead[];
  /** The ones the reader wasn't sure of, also written on the card's notes. */
  unsure: TrackedRead[];
}

/** The formation the ball was snapped from, as the film names it ("" when it couldn't be read: the sheet or a coach supplies it). */
export function filmFormationText(file: TrackedPlayFile): string {
  const snap = file.formations?.snap;
  return snap && snap.key !== "unknown" ? snap.text : "";
}

/**
 * "Check formation: film read Aces Gun Right from 10 of 11 offensive players." when the card's formation came from the film
 * and the film didn't see the whole offense (or had to assume the line). On the first real plays a read from 9-10 men was right
 * once in four, so an incomplete read is shown as a guess to check, never as the formation.
 */
export function formationCheckNote(file: TrackedPlayFile): string {
  const snap = file.formations?.snap;
  if (!snap || snap.key === "unknown" || !snap.text) return "";
  const men = snap.men ?? 0;
  const assumed = /assumed/i.test(snap.notes ?? "");
  if (men >= 11 && !assumed) return "";
  const cap = (t: string) => t.replace(/\b\w/g, (c) => c.toUpperCase());
  return `Check formation: film read ${cap(snap.text)} from ${men} of 11 offensive players${assumed ? " (line assumed)" : ""}.`;
}

/** "Motion: set in Bunch Gun Right, snapped from Deuces Gun." when the formation changed between the set and the snap, else "". */
export function motionFormationNote(file: TrackedPlayFile): string {
  const set = file.formations?.set;
  const snap = file.formations?.snap;
  if (!set || !snap || set.key === "unknown" || snap.key === "unknown" || !set.text || !snap.text || set.text === snap.text) return "";
  const cap = (t: string) => t.replace(/\b\w/g, (c) => c.toUpperCase());
  return `Motion: set in ${cap(set.text)}, snapped from ${cap(snap.text)}.`;
}

/**
 * The card for one tracked play. With the sheet's row (`row`), the sheet stays ground truth
 * (formation, call, down, front) and only the routes and where each man stood come from the
 * tracks; without it the card is built from the formation the pre-snap reader named.
 */
export function cardFromTracks(
  file: TrackedPlayFile,
  row: HudlPlayCard | null,
  opts: { formation?: string; playName?: string; source?: string; playNumber?: number; trustFilmRoutes?: boolean } = {},
): TrackedCard {
  const { detection, reads: raw } = detectionFromTracks(file, { ...opts, formation: opts.formation || filmFormationText(file) });
  const motion = [motionFormationNote(file), row?.formation?.trim() || opts.formation ? "" : formationCheckNote(file)].filter(Boolean).join(" ");
  const built0 = row
    ? applyDetectionToCard(row, detection)
    : buildCardFromDetection(detection, opts.source ?? "tracked film", opts.playNumber ?? 1);
  const built = motion ? deriveCard({ ...built0, notes: built0.notes.trim() ? `${built0.notes.trim()} ${motion}` : motion }) : built0;

  // Which letter each man was matched to, on the card as it now stands (his own spots).
  const letters = matchDetectedLetters(detection, built);
  const reads: TrackedRead[] = raw.flatMap((r) => {
    const letter = letters.get(r.player);
    return letter ? [{ letter, kind: r.kind, confidence: r.confidence, runnerUp: r.runnerUp }] : [];
  });
  const unsure = reads.filter((r) => r.kind === "unknown" || (r.kind !== "block" && r.confidence < SURE_CONFIDENCE));
  const trust = opts.trustFilmRoutes ?? FILM_ROUTES_PROVEN;
  const notesOf = (card: HudlPlayCard, ...more: string[]) => [card.notes.trim(), ...more].filter(Boolean).join(" ");
  if (trust) {
    if (unsure.length === 0) return { card: built, reads, unsure };
    return { card: deriveCard({ ...built, notes: notesOf(built, checkNote(unsure)) }), reads, unsure };
  }
  const named = reads.filter((r) => r.kind !== "block" && r.kind !== "unknown").map((r) => `${r.letter} ${routeName(r.kind).toLowerCase()}`);
  if (row) {
    // The sheet's call stays the routes; the film's reads are only listed, so a wrong one can't be mistaken for the play.
    const kept = Object.fromEntries(Object.entries(built.routeOverrides ?? {}).filter(([, v]) => v.source !== "video"));
    const stripped = { ...built, routeOverrides: Object.keys(kept).length ? kept : undefined };
    const note = named.length ? `Film's route reads (unchecked, not drawn): ${named.join(", ")}.` : "";
    return { card: deriveCard({ ...stripped, notes: notesOf(stripped, note) }), reads, unsure };
  }
  const note = "Routes read from film, unchecked: confirm each one.";
  return { card: deriveCard({ ...built, notes: notesOf(built, unsure.length ? checkNote(unsure) : "", note) }), reads, unsure };
}

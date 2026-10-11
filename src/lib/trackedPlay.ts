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

export interface TrackedPlayFile {
  fps?: number;
  tracks: TrackedPlayer[];
}

/** A lineman: on the line and inside the box. Skill players are everyone else on offense. */
const ON_LINE_MIN_Y = -0.8;
const BOX_HALF_WIDTH_YARDS = 3.5;
/** A man on the line who ran this far (or more) was a receiver, not a lineman. */
const LINEMAN_MAX_TRAVEL_YARDS = 7;
/** The quarterback is the man nearest the ball behind the center. */
const QB_MAX_ACROSS_YARDS = 2.5;
/** He stands at least this far behind the line's depth (a guard a yard off the ball does not). */
const QB_BEHIND_LINE_YARDS = 0.8;
/** A read this unsure (margin over the runner-up) is flagged for a coach. */
export const SURE_CONFIDENCE = 0.25;
/** The snap is when this many offensive men have all started to move: a man or two in motion before it do not count. */
const SNAP_MOVERS = 4;
const MOVED_YARDS = 1.5;
/** Take the snap a little before the third man's move shows. */
const SNAP_LEAD_SECONDS = 0.35;

/** Faster than any high-school player runs (yards a second): a bigger jump is the tracker changing men. */
const MAX_YARDS_PER_SECOND = 14;
/** Compare points at least this far apart in time, so a frame of jitter doesn't look like a jump. */
const JUMP_WINDOW_SECONDS = 0.3;
/** Two tracks starting this close are one man followed twice. */
const SAME_MAN_YARDS = 1.2;
/** The shortest route in the tree runs about this far; less than that hasn't shown which route it is. */
const MIN_ROUTE_YARDS = 5;

type ReadKind = RouteKind | "block" | "unknown";

/**
 * The part of a track before the tracker jumped to another man: a move faster than anyone can
 * run, over a short window, means the track was handed to someone else. What came after belongs
 * to him, not to this receiver, so it is cut off rather than read as a route.
 */
export function trimAtJump(points: [number, number, number][]): [number, number, number][] {
  for (let i = 1; i < points.length; i++) {
    let j = i - 1;
    while (j > 0 && points[i][0] - points[j][0] < JUMP_WINDOW_SECONDS) j -= 1;
    const dt = points[i][0] - points[j][0];
    if (dt <= 0) continue;
    const gap = Math.hypot(points[i][1] - points[j][1], points[i][2] - points[j][2]);
    if (gap / Math.max(dt, JUMP_WINDOW_SECONDS) > MAX_YARDS_PER_SECOND) return points.slice(0, i);
  }
  return points;
}

/** One man followed twice (two ids that start on the same spot) counts once: the longer track. */
function dropSameMan(tracks: TrackedPlayer[]): TrackedPlayer[] {
  const longest = [...tracks].sort((a, b) => b.points.length - a.points.length);
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
  return t.start[1] >= cutoff && Math.abs(t.start[0]) <= BOX_HALF_WIDTH_YARDS && pathLength(t.points) < LINEMAN_MAX_TRAVEL_YARDS;
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
  const followed = dropSameMan(fromTheSnap(file).tracks.filter((t) => t.team === "offense" && t.points.length >= 2));
  const qb = pickQuarterback(followed);
  const cutoff = lineCutoff(followed);
  // Everyone but the quarterback is read only up to where his track jumped to another man.
  const offense = followed
    .map((t) => (t === qb ? t : { ...t, points: trimAtJump(t.points) }))
    .filter((t) => t.points.length >= 2);
  const players: DetectedPlayer[] = [];
  const reads: RawRead[] = [];

  for (const t of offense) {
    const start = { x: t.start[0], y: t.start[1] };
    if (qb && t.id === qb.id) {
      players.push({ label: "Q", start, waypoints: [], endpoint: start, routeType: "NONE" });
      continue;
    }
    if (isLineman(t, cutoff)) continue;
    const path = t.points.map(([, x, y]) => ({ x, y }));
    const raw = readRoute(path, t.start[0] < 0 ? -1 : 1);
    // A path cut short (lost, or handed to another man) hasn't shown which route it was.
    const read =
      raw.kind !== "block" && pathLength(t.points) < MIN_ROUTE_YARDS
        ? { ...raw, kind: "unknown" as const, confidence: 0 }
        : raw;
    const player: DetectedPlayer = {
      label: "?",
      start,
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

/**
 * The card for one tracked play. With the sheet's row (`row`), the sheet stays ground truth
 * (formation, call, down, front) and only the routes and where each man stood come from the
 * tracks; without it the card is built from the formation the pre-snap reader named.
 */
export function cardFromTracks(
  file: TrackedPlayFile,
  row: HudlPlayCard | null,
  opts: { formation?: string; playName?: string; source?: string; playNumber?: number } = {},
): TrackedCard {
  const { detection, reads: raw } = detectionFromTracks(file, opts);
  const built = row
    ? applyDetectionToCard(row, detection)
    : buildCardFromDetection(detection, opts.source ?? "tracked film", opts.playNumber ?? 1);

  // Which letter each man was matched to, on the card as it now stands (his own spots).
  const letters = matchDetectedLetters(detection, built);
  const reads: TrackedRead[] = raw.flatMap((r) => {
    const letter = letters.get(r.player);
    return letter ? [{ letter, kind: r.kind, confidence: r.confidence, runnerUp: r.runnerUp }] : [];
  });
  const unsure = reads.filter((r) => r.kind === "unknown" || (r.kind !== "block" && r.confidence < SURE_CONFIDENCE));
  if (unsure.length === 0) return { card: built, reads, unsure };
  const note = checkNote(unsure);
  const notes = built.notes.trim() ? `${built.notes.trim()} ${note}` : note;
  return { card: deriveCard({ ...built, notes }), reads, unsure };
}

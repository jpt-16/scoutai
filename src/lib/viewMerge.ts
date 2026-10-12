/**
 * Two angles of one play, read as one.
 *
 * A game filmed from the press box and from the end zone gives two tracks files for each play (`play_007.json` and
 * `play_007_b.json`). Both are in the same field frame (yards from the ball at the snap, x to the offense's right, y upfield),
 * so a man in one is the same man in the other, found within a yard or two of where the other camera put him. Each camera
 * loses different men (a receiver behind a defender from one side is clear from the other), so the merge keeps the fuller
 * track for each man and adds the men only one camera saw, up to a team's eleven.
 *
 * Judging that the two views really are the same play matters as much as merging them: a wrong pairing (the plays were
 * matched by when they happened, not by what they show) merges two different plays into nonsense. So the views must agree
 * about where the people stood before anything is merged (`MIN_AGREEING_MEN`); if they don't, the first view is used alone and
 * the report says so, and the card says the second angle didn't line up.
 *
 * Framework-free, so Vitest and the Node scripts run it directly.
 */

import type { TrackedPlayer, TrackedPlayFile } from "./trackedPlay";

/** Two men this close at the snap (after the cameras' small offset is taken out) are one man seen twice. */
export const MATCH_YARDS = 1.5;
/** How far a calibration's idea of "the ball" may differ between views and still be taken out as a shift. */
const MAX_SHIFT_YARDS = 3;
/** The two views' men are paired for the shift within this distance. */
const SHIFT_SEARCH_YARDS = 4;
/** A track from the other view is joined onto this one only if it is within this of where this one ends. */
const JOIN_YARDS = 3;
/** A runner's top speed, for judging that a joined stretch carries on from where the first track ended. */
const STEP_YARDS_PER_SECOND = 9;
/** The other view's track must run this much longer than this one for it to be worth joining. */
const EXTEND_SECONDS = 0.5;
/** Fewest men found in both views for them to count as the same play. */
export const MIN_AGREEING_MEN = 6;
const TEAM_SIZE = 11;
/** Men the other view found alone are only added if they stood where the players do. */
const FIELD_X = 28;
const FIELD_Y_MIN = -12;
const FIELD_Y_MAX = 16;

export interface MergeReport {
  /** Men found in both views. */
  matched: number;
  /** Tracks joined to a longer stretch from the other view. */
  extended: number;
  /** Men only the other view found, added. */
  added: number;
  /** The shift taken out of the other view (yards), where the two cameras put the ball differently. */
  shift: [number, number];
  /** False when the views didn't agree about where the people stood: the other view was left out. */
  used: boolean;
}

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lastTime = (t: TrackedPlayer) => (t.points.length ? t.points[t.points.length - 1][0] : 0);

function median(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Greedy one-to-one pairing of same-team men by how close they stood at the snap, closest first. */
function pairMen(a: TrackedPlayer[], b: TrackedPlayer[], within: number, shift: [number, number] = [0, 0]): [TrackedPlayer, TrackedPlayer][] {
  const candidates: { i: number; j: number; d: number }[] = [];
  a.forEach((p, i) =>
    b.forEach((q, j) => {
      if (p.team !== q.team) return;
      const d = dist(p.start, [q.start[0] - shift[0], q.start[1] - shift[1]]);
      if (d <= within) candidates.push({ i, j, d });
    }),
  );
  candidates.sort((x, y) => x.d - y.d);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const pairs: [TrackedPlayer, TrackedPlayer][] = [];
  for (const c of candidates) {
    if (usedA.has(c.i) || usedB.has(c.j)) continue;
    usedA.add(c.i);
    usedB.add(c.j);
    pairs.push([a[c.i], b[c.j]]);
  }
  return pairs;
}

function shifted(t: TrackedPlayer, shift: [number, number]): TrackedPlayer {
  return {
    ...t,
    start: [t.start[0] - shift[0], t.start[1] - shift[1]],
    points: t.points.map(([s, x, y]) => [s, x - shift[0], y - shift[1]] as [number, number, number]),
  };
}

/**
 * Merges the second view into the first. Both are in the same field frame; the second is first lined up with the first (the
 * cameras put "the ball" a little differently), then each man found in both keeps the fuller of his two tracks and any later
 * stretch the other view followed him through; men only the second view found are added up to a team of eleven.
 */
export function mergeViews(first: TrackedPlayFile, second: TrackedPlayFile): { file: TrackedPlayFile; report: MergeReport } {
  const none: MergeReport = { matched: 0, extended: 0, added: 0, shift: [0, 0], used: false };
  if (!first.tracks.length) {
    // The first view found nobody: the second is all there is.
    return { file: { ...second }, report: { ...none, added: second.tracks.length, used: second.tracks.length > 0 } };
  }
  if (!second.tracks.length) return { file: first, report: none };

  // 1. The cameras' small disagreement about where the ball is: the median offset between men who stood near each other.
  const rough = pairMen(first.tracks, second.tracks, SHIFT_SEARCH_YARDS);
  let shift: [number, number] = [0, 0];
  if (rough.length >= MIN_AGREEING_MEN) {
    const dx = median(rough.map(([a, b]) => b.start[0] - a.start[0]));
    const dy = median(rough.map(([a, b]) => b.start[1] - a.start[1]));
    if (Math.hypot(dx, dy) <= MAX_SHIFT_YARDS) shift = [dx, dy];
  }

  // 2. Who is who, once lined up.
  const pairs = pairMen(first.tracks, second.tracks, MATCH_YARDS, shift);
  if (pairs.length < MIN_AGREEING_MEN) return { file: first, report: { ...none, matched: pairs.length, shift } };

  const other = second.tracks.map((t) => shifted(t, shift));
  const otherById = new Map(other.map((t) => [t.id, t]));
  const mate = new Map(pairs.map(([a, b]) => [a.id, otherById.get(b.id)!]));
  let extended = 0;
  const merged: TrackedPlayer[] = first.tracks.map((t) => {
    const m = mate.get(t.id);
    if (!m) return t;
    // The other view follows him further: it joins on if it picks up where this one left off, and carries on from there
    // (a handed-off track that happens to cross the join is not joined: the next point after it must be a runner's step away).
    if (lastTime(m) > lastTime(t) + EXTEND_SECONDS && t.points.length && m.points.length) {
      const end = t.points[t.points.length - 1];
      const at = m.points.reduce((best, p) => (Math.abs(p[0] - end[0]) < Math.abs(best[0] - end[0]) ? p : best), m.points[0]);
      const later = m.points.filter((p) => p[0] > end[0]);
      const next = later[0];
      const stepOk = next && Math.hypot(next[1] - end[1], next[2] - end[2]) <= JOIN_YARDS + STEP_YARDS_PER_SECOND * (next[0] - end[0]);
      if (Math.hypot(at[1] - end[1], at[2] - end[2]) <= JOIN_YARDS && stepOk) {
        extended++;
        return { ...t, points: [...t.points, ...later] };
      }
    }
    return t;
  });

  // 3. Men only the other view found, where players stand and only up to a full team.
  const matchedOther = new Set(pairs.map(([, b]) => b.id));
  const count = (team: TrackedPlayer["team"]) => merged.filter((t) => t.team === team).length;
  let nextId = Math.max(0, ...first.tracks.map((t) => t.id)) + 1;
  let added = 0;
  const lone = other
    .filter((t) => !matchedOther.has(t.id))
    .filter((t) => Math.abs(t.start[0]) <= FIELD_X && t.start[1] >= FIELD_Y_MIN && t.start[1] <= FIELD_Y_MAX)
    .sort((a, b) => Math.hypot(...a.start) - Math.hypot(...b.start));
  for (const t of lone) {
    if (count(t.team) >= TEAM_SIZE) continue;
    merged.push({ ...t, id: nextId++ });
    added++;
  }

  return { file: { ...first, tracks: merged }, report: { matched: pairs.length, extended, added, shift, used: true } };
}

/** Folds several views into the first, in order. */
export function mergeAll(files: TrackedPlayFile[]): { file: TrackedPlayFile; reports: MergeReport[] } {
  let file = files[0];
  const reports: MergeReport[] = [];
  for (const next of files.slice(1)) {
    const merged = mergeViews(file, next);
    file = merged.file;
    reports.push(merged.report);
  }
  return { file, reports };
}

/**
 * `play_007.json`, `play_007_b.json`, `play_007_c.json`: which names are views of one play. Returns each play's files, its first
 * view (no suffix) first; a name with no suffix and no other views is a play of its own.
 */
export function groupViews(names: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const name of names) {
    const m = name.match(/^(.*?)(_[b-d])?(\.[A-Za-z0-9]+)?$/);
    const base = m ? `${m[1]}${m[3] ?? ""}` : name;
    (groups.get(base) ?? groups.set(base, []).get(base)!).push(name);
  }
  for (const list of groups.values()) list.sort((x, y) => Number(/_[b-d]\./.test(x)) - Number(/_[b-d]\./.test(y)) || x.localeCompare(y));
  return groups;
}

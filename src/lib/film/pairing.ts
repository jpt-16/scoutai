/**
 * Two angles of one game, found from when the snaps happened.
 *
 * Film is sometimes sent as one view from the press box and one from the end zone: two recordings of the same plays.
 * Uploaded as separate videos they would come out as two games' worth of plays, every play twice. The splitter
 * (`eval/split.py`) gives each video's snap times; two videos of the same game share the same snaps, shifted by however
 * much later one recording started than the other. This finds that shift, decides whether the videos are the same game
 * at all (two halves, or a first half and a second, share nothing), and lines the snaps up one to one.
 *
 * Pure (numbers in, numbers out) so it is tested alone. The thresholds are at the top.
 */

/** Two snaps this close (after the shift) are the same play: the cameras don't see the burst start at quite the same moment. */
export const SNAP_TOLERANCE_SECONDS = 2.0;
/** Fewest plays seen in both for two videos to be called the same game. */
export const MIN_SHARED_PLAYS = 3;
/** And at least this share of the shorter video's plays. */
export const MIN_SHARED_FRACTION = 0.5;
/** How many of the strongest offsets are scored exactly. */
const CANDIDATES = 6;

export interface Matched {
  /** Index into the first list, index into the second. */
  a: number;
  b: number;
  /** Seconds the two snaps are apart once shifted (signed: b minus a minus offset). */
  residual: number;
}

export interface Alignment {
  /** Add this to a time in the first video to get the same moment in the second. */
  offset: number;
  matches: Matched[];
  /** The same game seen from two places? */
  same: boolean;
}

/** One-to-one nearest matches of `a` to `b` once `b` is shifted back by `offset`, within the tolerance. Both sorted. */
export function matchSnaps(a: number[], b: number[], offset: number, tolerance = SNAP_TOLERANCE_SECONDS): Matched[] {
  const matches: Matched[] = [];
  let j = 0;
  const taken = new Set<number>();
  for (let i = 0; i < a.length; i++) {
    const target = a[i] + offset;
    while (j < b.length && b[j] < target - tolerance) j++;
    // The nearest unused snap in the window.
    let best = -1;
    let bestGap = Infinity;
    for (let k = j; k < b.length && b[k] <= target + tolerance; k++) {
      const gap = Math.abs(b[k] - target);
      if (!taken.has(k) && gap < bestGap) {
        best = k;
        bestGap = gap;
      }
    }
    if (best >= 0) {
      taken.add(best);
      matches.push({ a: i, b: best, residual: b[best] - target });
    }
  }
  return matches;
}

function median(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The shift that lines `b`'s snaps up with `a`'s, and whether that is the same game. Every pair of snaps votes for the shift
 * that would make it a match; the strongest shifts are scored exactly, and the best is refined by the median of its residuals.
 */
export function alignSnaps(aIn: number[], bIn: number[]): Alignment {
  const a = [...aIn].sort((x, y) => x - y);
  const b = [...bIn].sort((x, y) => x - y);
  const none: Alignment = { offset: 0, matches: [], same: false };
  if (a.length < MIN_SHARED_PLAYS || b.length < MIN_SHARED_PLAYS) return none;

  // Votes: each pair (a_i, b_j) suggests offset b_j - a_i, binned at the tolerance.
  const bin = SNAP_TOLERANCE_SECONDS;
  const votes = new Map<number, number>();
  for (const x of a) {
    for (const y of b) {
      const key = Math.round((y - x) / bin);
      votes.set(key, (votes.get(key) ?? 0) + 1);
    }
  }
  // A bin and its neighbors together (a true shift straddles two bins), strongest first.
  const scored = [...votes.keys()]
    .map((k) => ({ k, v: (votes.get(k) ?? 0) + (votes.get(k - 1) ?? 0) + (votes.get(k + 1) ?? 0) }))
    .sort((p, q) => q.v - p.v)
    .slice(0, CANDIDATES);

  let best: Alignment = none;
  for (const { k } of scored) {
    const nearby = [] as number[];
    for (const x of a) for (const y of b) if (Math.abs(y - x - k * bin) <= bin * 1.5) nearby.push(y - x);
    if (!nearby.length) continue;
    let offset = median(nearby);
    let matches = matchSnaps(a, b, offset);
    if (matches.length) {
      offset += median(matches.map((m) => m.residual)); // refine on the matched pairs
      matches = matchSnaps(a, b, offset);
    }
    if (matches.length > best.matches.length) best = { offset, matches, same: false };
  }

  const shorter = Math.min(a.length, b.length);
  const same = best.matches.length >= MIN_SHARED_PLAYS && best.matches.length >= MIN_SHARED_FRACTION * shorter;
  return { ...best, same };
}

/* ------------------------------------------------------------------ groups of videos and the plays across them */

export interface VideoSnaps {
  index: number;
  /** Seconds of each snap in this video. */
  snaps: number[];
}

export interface PlayView {
  video: number;
  /** Which snap of that video (its position in the sorted list). */
  snap: number;
}

export interface GroupedPlay {
  /** The moment on the group's own timeline (the primary video's clock). */
  time: number;
  views: PlayView[];
}

export interface VideoGroup {
  /** The video to read: the one marked as the press box (else the first uploaded of the group). */
  primary: number;
  /** Video indexes, the primary first. */
  videos: number[];
  /** Add this to a time in a video to get the same moment in the primary video (0 for the primary itself). */
  toPrimary: Record<number, number>;
  /** Plays in time order (on the primary's clock), each seen from one or more videos, the primary's view first. */
  plays: GroupedPlay[];
}

/**
 * Which videos are the same game seen from several places, and the plays across them. Videos that share snaps are one group.
 * `read` is the videos the coach marked as the one to read (the press box): each group's primary is its first marked video,
 * or its first video if none is marked, and every time in the group is on the primary's clock. Groups come out in order of
 * their first video.
 */
export function groupVideos(videos: VideoSnaps[], read: ReadonlySet<number> = new Set()): VideoGroup[] {
  const ordered = [...videos].sort((x, y) => x.index - y.index);
  const byIndex = new Map(ordered.map((v) => [v.index, v]));
  // Pass 1: join each video to the first earlier group it shares snaps with, on that group's first video's clock.
  const anchorClock = new Map<number, number>(); // video -> add to its time for its group anchor's clock
  const groups: { anchor: number; ids: number[] }[] = [];
  for (const v of ordered) {
    let joined = false;
    for (const g of groups) {
      const al = alignSnaps(byIndex.get(g.anchor)!.snaps, v.snaps);
      if (al.same) {
        g.ids.push(v.index);
        anchorClock.set(v.index, -al.offset);
        joined = true;
        break;
      }
    }
    if (!joined) {
      groups.push({ anchor: v.index, ids: [v.index] });
      anchorClock.set(v.index, 0);
    }
  }

  // Pass 2: choose each group's primary and put every video on its clock.
  const out: VideoGroup[] = groups.map((g) => {
    const primary = g.ids.find((i) => read.has(i)) ?? g.ids[0];
    const shift = anchorClock.get(primary) ?? 0;
    const toPrimary: Record<number, number> = {};
    for (const i of g.ids) toPrimary[i] = (anchorClock.get(i) ?? 0) - shift;

    const all = g.ids.flatMap((i) => [...byIndex.get(i)!.snaps].sort((x, y) => x - y).map((t, snap) => ({ video: i, snap, t: t + toPrimary[i] })));
    all.sort((x, y) => x.t - y.t);
    const plays: GroupedPlay[] = [];
    for (const s of all) {
      // Join the latest play that doesn't already have a view from this video and is close enough in time.
      const last = plays.at(-1);
      if (last && !last.views.some((v) => v.video === s.video) && s.t - last.time <= SNAP_TOLERANCE_SECONDS) {
        last.views.push({ video: s.video, snap: s.snap });
        last.time = (last.time * (last.views.length - 1) + s.t) / last.views.length;
      } else {
        plays.push({ time: s.t, views: [{ video: s.video, snap: s.snap }] });
      }
    }
    for (const p of plays) p.views.sort((x, y) => (x.video === primary ? -1 : y.video === primary ? 1 : x.video - y.video));
    return { primary, videos: [primary, ...g.ids.filter((i) => i !== primary)], toPrimary, plays };
  });
  return out.sort((x, y) => Math.min(...x.videos) - Math.min(...y.videos));
}

import { describe, expect, it } from "vitest";
import { MIN_SHARED_PLAYS, SNAP_TOLERANCE_SECONDS, alignSnaps, groupVideos, matchSnaps } from "./pairing";

/** A small seeded random number generator, so the "random" games below are the same every run. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A game's snaps: a play every 25-50 seconds. */
function game(seed: number, plays: number, start = 20): number[] {
  const r = rng(seed);
  const out: number[] = [];
  let t = start;
  for (let i = 0; i < plays; i++) {
    out.push(t);
    t += 25 + r() * 25;
  }
  return out;
}

/** The same game from a second camera that started `offset` seconds later: jittered snaps, some missed, some invented. */
function otherAngle(snaps: number[], offset: number, seed: number, { jitter = 0.8, miss = 0.1, extra = 3 } = {}): number[] {
  const r = rng(seed);
  const seen = snaps.filter(() => r() > miss).map((s) => s + offset + (r() * 2 - 1) * jitter);
  for (let i = 0; i < extra; i++) seen.push(r() * (snaps.at(-1)! + offset));
  return seen.filter((s) => s > 0).sort((x, y) => x - y);
}

describe("matchSnaps", () => {
  it("pairs each snap with the nearest one within the tolerance, once", () => {
    const m = matchSnaps([10, 50, 90], [12, 51, 200], 0);
    expect(m.map((x) => [x.a, x.b])).toEqual([[0, 0], [1, 1]]);
    // one snap in b can't answer two in a
    expect(matchSnaps([10, 11], [10.5], 0)).toHaveLength(1);
  });

  it("shifts b back by the offset first", () => {
    expect(matchSnaps([10, 50], [110, 150], 100)).toHaveLength(2);
    expect(matchSnaps([10, 50], [110, 150], 0)).toHaveLength(0);
  });
});

describe("alignSnaps", () => {
  it("finds the shift between two cameras of the same game, through jitter, misses and extras", () => {
    const a = game(1, 60);
    for (const offset of [37.4, -12.9, 0, 410.25]) {
      const b = otherAngle(a, offset, 7);
      const al = alignSnaps(a, b);
      expect(al.same).toBe(true);
      expect(Math.abs(al.offset - offset)).toBeLessThan(0.6);
      expect(al.matches.length).toBeGreaterThanOrEqual(45);
      // every match is within the tolerance
      expect(al.matches.every((m) => Math.abs(m.residual) <= SNAP_TOLERANCE_SECONDS)).toBe(true);
    }
  });

  it("works on a short stretch of film too", () => {
    const a = game(2, 6);
    const al = alignSnaps(a, otherAngle(a, 55, 3, { miss: 0, extra: 0 }));
    expect(al.same).toBe(true);
    expect(al.matches).toHaveLength(6);
  });

  it("does not take two different recordings for one game: independent games, 300 of them", () => {
    let wrong = 0;
    for (let s = 0; s < 300; s++) {
      const a = game(1000 + s, 50);
      const b = game(5000 + s, 50, 5 + (s % 40));
      if (alignSnaps(a, b).same) wrong++;
    }
    expect(wrong).toBeLessThanOrEqual(2); // under 1%
  });

  it("does not take the first half and the second half for the same game", () => {
    const first = game(11, 40);
    const second = game(12, 40);
    expect(alignSnaps(first, second).same).toBe(false);
  });

  it("needs a handful of snaps to say anything", () => {
    expect(alignSnaps([10, 50], [10, 50]).same).toBe(false);
    expect(alignSnaps([], [10, 50, 90]).same).toBe(false);
    expect(MIN_SHARED_PLAYS).toBeGreaterThanOrEqual(3);
  });

  it("doesn't need its inputs sorted", () => {
    const a = game(3, 30);
    const b = otherAngle(a, 20, 4);
    const al = alignSnaps([...a].reverse(), [...b].reverse());
    expect(al.same).toBe(true);
    expect(Math.abs(al.offset - 20)).toBeLessThan(0.6);
  });
});

describe("groupVideos", () => {
  it("puts two angles of one game in one group, each play seen from both", () => {
    const press = game(21, 40);
    const endZone = otherAngle(press, 63, 8, { miss: 0, extra: 0, jitter: 0.5 });
    const [g, ...rest] = groupVideos([{ index: 0, snaps: press }, { index: 1, snaps: endZone }]);
    expect(rest).toEqual([]);
    expect(g.videos).toEqual([0, 1]);
    expect(g.plays).toHaveLength(40);
    expect(g.plays.every((p) => p.views.length === 2 && p.views[0].video === 0 && p.views[1].video === 1)).toBe(true);
    // the play's time is on the primary's clock, in order
    expect(g.plays.map((p) => p.time)).toEqual([...g.plays.map((p) => p.time)].sort((x, y) => x - y));
    expect(Math.abs(g.plays[5].time - press[5])).toBeLessThan(1);
  });

  it("keeps a play only one camera saw as its own play, in the right place", () => {
    const press = game(22, 30);
    const endZone = otherAngle(press, -9, 9, { miss: 0, extra: 0 }).filter((_, i) => i !== 10); // the end zone missed play 10
    const press2 = press.filter((_, i) => i !== 20); // the press box missed play 20
    const [g] = groupVideos([{ index: 0, snaps: press2 }, { index: 1, snaps: endZone }]);
    expect(g.plays).toHaveLength(30);
    const single = g.plays.filter((p) => p.views.length === 1);
    expect(single.map((p) => p.views[0].video).sort()).toEqual([0, 1]);
  });

  it("keeps different parts of a game apart, and pairs the angles within each", () => {
    const h1 = game(31, 35);
    const h2 = game(32, 35);
    // upload order: press box 1st half, press box 2nd half, end zone 1st half, end zone 2nd half
    const groups = groupVideos([
      { index: 0, snaps: h1 },
      { index: 1, snaps: h2 },
      { index: 2, snaps: otherAngle(h1, 14, 5, { miss: 0, extra: 0 }) },
      { index: 3, snaps: otherAngle(h2, -6, 6, { miss: 0, extra: 0 }) },
    ]);
    expect(groups.map((g) => g.videos)).toEqual([[0, 2], [1, 3]]);
    expect(groups.map((g) => g.plays.length)).toEqual([35, 35]);
    expect(groups.every((g) => g.plays.every((p) => p.views.length === 2))).toBe(true);
  });

  it("leaves a single video as a single group of single views", () => {
    const [g] = groupVideos([{ index: 0, snaps: game(41, 12) }]);
    expect(g.videos).toEqual([0]);
    expect(g.plays).toHaveLength(12);
    expect(g.plays.every((p) => p.views.length === 1)).toBe(true);
  });

  it("handles three angles of one game", () => {
    const a = game(51, 30);
    const [g] = groupVideos([
      { index: 0, snaps: a },
      { index: 1, snaps: otherAngle(a, 30, 1, { miss: 0, extra: 0 }) },
      { index: 2, snaps: otherAngle(a, -15, 2, { miss: 0, extra: 0 }) },
    ]);
    expect(g.videos).toEqual([0, 1, 2]);
    expect(g.plays).toHaveLength(30);
    expect(g.plays.every((p) => p.views.length === 3)).toBe(true);
  });
});

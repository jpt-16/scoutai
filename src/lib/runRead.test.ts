import { describe, expect, it } from "vitest";
import { parseHudlCsvText } from "./hudlParser";
import { applyRunRead, readRun, runCall } from "./runRead";
import type { TrackedPlayFile } from "./trackedPlay";

type Key = [number, number, number]; // seconds after the snap, x, y (yards)
const SNAP = 1; // a still second before the ball is snapped, like real film

/** A man's track at 10 frames a second: standing still, then through his key spots in a straight line between each. */
function man(team: "offense" | "defense", id: number, start: [number, number], keys: Key[] = []): TrackedPlayFile["tracks"][number] {
  const all: Key[] = [[0, start[0], start[1]], ...keys];
  const points: [number, number, number][] = [];
  for (let f = 0; f <= 60; f++) {
    const t = f / 10;
    const dt = t - SNAP;
    let x = start[0];
    let y = start[1];
    if (dt > 0) {
      const next = all.findIndex(([k]) => k >= dt);
      if (next === -1) [, x, y] = all[all.length - 1];
      else {
        const [t0, x0, y0] = all[next - 1] ?? all[0];
        const [t1, x1, y1] = all[next];
        const u = t1 === t0 ? 1 : (dt - t0) / (t1 - t0);
        x = x0 + (x1 - x0) * u;
        y = y0 + (y1 - y0) * u;
      }
    }
    points.push([t, x, y]);
  }
  return { id, team, start, points };
}

const LINE = [-2.4, -1.2, 0, 1.2, 2.4];
/** A shotgun 2x2 offense: each player's keys after the snap (empty = he stays put). */
function play(opts: {
  line?: (x: number) => Key[];
  qb?: Key[];
  qbAt?: [number, number];
  back?: Key[];
  receivers?: Key[][];
}): TrackedPlayFile {
  const recv: [number, number][] = [[-18, -0.5], [-9, -1.2], [9, -1.2], [18, -0.5]];
  const tracks = [
    ...LINE.map((x, i) => man("offense", i, [x, -0.8], opts.line?.(x) ?? [[0.8, x, 0.4], [2, x, 0.8]])),
    man("offense", 5, opts.qbAt ?? [0, -5], opts.qb ?? [[0.5, 0, -5.5]]),
    man("offense", 6, [1.5, -5.5], opts.back ?? []),
    ...recv.map((p, i) => man("offense", 7 + i, p, opts.receivers?.[i] ?? [[1, p[0], p[1] + 3], [4, p[0], p[1] + 3.5]])),
    // A defense standing in front, which the run read ignores.
    ...[-3, -1, 1, 3, -4, 4].map((x, i) => man("defense", 20 + i, [x, x * x > 9 ? 5 : 1])),
  ];
  return { tracks };
}

describe("reading run plays from film", () => {
  it("power: the backside guard pulls to the play side and the back follows him", () => {
    const read = readRun(
      play({
        line: (x) => (x === -1.2 ? [[0.5, 0, -1.6], [1, 3.6, -1.4], [1.6, 4.5, 1.5]] : x > -1.2 ? [[0.8, x - 0.6, 0.6]] : [[0.8, x, -1.2]]),
        back: [[0.6, 1.8, -4.2], [1.4, 3, 0.5], [2.5, 4, 6]],
      }),
    );
    expect([read.kind, read.scheme, read.direction]).toEqual(["run", "power", "right"]);
    expect(runCall(read)).toBe("POWER RT");
  });

  it("counter: the guard and tackle both pull, and the back steps away first", () => {
    const read = readRun(
      play({
        line: (x) => (x > 0 ? [[0.5, x - 1, -1.7], [1, x - 4, -1.6], [1.6, x - 5.5, 1]] : [[0.8, x + 0.6, 0.6]]),
        back: [[0.4, 2.3, -5.4], [1, 0, -3.5], [1.6, -3, 0.5], [2.5, -4, 6]],
      }),
    );
    expect([read.kind, read.scheme, read.direction]).toEqual(["run", "counter", "left"]);
  });

  it("inside zone: no pullers, the whole line steps the same way and the back hits it inside", () => {
    const read = readRun(
      play({
        line: (x) => [[0.8, x + 1.0, -0.2], [2, x + 1.5, 0.8]],
        back: [[0.6, 1.8, -3.8], [1.3, 2, 0.6], [2.5, 2.2, 6]],
      }),
    );
    expect([read.kind, read.scheme, read.direction]).toEqual(["run", "zone", "right"]);
  });

  it("iso: the line fires straight ahead and the back goes up the middle", () => {
    const read = readRun(
      play({
        line: (x) => [[0.8, x, 0.6], [2, x, 1.5]],
        back: [[0.6, 0.6, -3.8], [1.3, -0.5, 0.6], [2.5, -0.5, 6]],
      }),
    );
    expect([read.kind, read.scheme]).toEqual(["run", "iso"]);
  });

  it("toss: the back is out wide behind the line within a second", () => {
    const read = readRun(play({ line: (x) => [[0.8, x + 1.4, -0.4]], back: [[1.1, 9, -3.5], [1.8, 11, 0.5], [3, 12, 7]] }));
    expect([read.kind, read.scheme, read.direction]).toEqual(["run", "toss", "right"]);
  });

  it("jet: a slot comes across behind the line and carries it", () => {
    const receivers: Key[][] = [[], [], [[0.5, 4, -2.5], [1.0, -1, -2.5], [1.5, -5, -1], [2.2, -7, 3]], []];
    const read = readRun(play({ line: (x) => [[0.8, x - 1.4, -0.4]], receivers, back: [[0.8, 2.5, -4]] }));
    expect([read.kind, read.scheme, read.direction]).toEqual(["run", "jet", "left"]);
  });

  it("a pass: the line sets back and the receivers release deep", () => {
    const deep: Key[][] = [0, 1, 2, 3].map(() => [[1.5, 0, 9], [3, 0, 16]]).map((k, i) => k.map(([t, , y]) => [t, [-18, -9, 9, 18][i], y] as Key));
    const read = readRun(play({ line: (x) => [[0.8, x, -1.8]], qb: [[1, 0, -7.5]], receivers: deep }));
    expect(read.kind).toBe("pass");
    expect(read.scheme).toBeNull();
  });
});

describe("putting a run on the card", () => {
  const read = readRun(
    play({
      line: (x) => (x === -1.2 ? [[0.5, 0, -1.6], [1, 3.6, -1.4], [1.6, 4.5, 1.5]] : x > -1.2 ? [[0.8, x - 0.6, 0.6]] : [[0.8, x, -1.2]]),
      back: [[0.6, 1.8, -4.2], [1.4, 3, 0.5], [2.5, 4, 6]],
    }),
  );

  it("a film card with no call draws the read: POWER right, a run, with the reason noted", () => {
    const [blank] = parseHudlCsvText("PLAY #,OFF FORM,OFF PLAY\n1,SPREAD,\n").cards;
    const card = applyRunRead(blank, read);
    expect(card.playCall).toBe("POWER RT");
    expect(card.playDirection).toBe("right");
    expect(card.notes).toContain("carried it right");
  });

  it("a card whose sheet named the call keeps it", () => {
    const [called] = parseHudlCsvText("PLAY #,OFF FORM,OFF PLAY\n1,SPREAD,IZ LT\n").cards;
    expect(applyRunRead(called, read).playCall).toBe("IZ LT");
  });
});

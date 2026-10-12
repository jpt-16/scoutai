import { describe, expect, it } from "vitest";
import { applyCoverageRead, coverageFamilyOf, readCoverage } from "./coverageRead";
import { parseHudlCsvText } from "./hudlParser";
import type { TrackedPlayer, TrackedPlayFile } from "./trackedPlay";

/*
 * Drawn plays: Duces (2x2, a back beside the quarterback) against an eleven-man defense, every man's path in yards from
 * the ball (offense's view), 30 points a second, one second standing still before the snap, with a tracker's jitter
 * (+-0.3 yd) and a tenth of the points missing.
 */

type XY = [number, number];
const FPS = 30;
const SPEED = 7; // yd/s, a high-school receiver

/** Walks waypoints (relative to the start) at `speed`: where he is `t` seconds after the snap. */
function route(start: XY, waypoints: XY[], speed = SPEED): (t: number) => XY {
  const pts: XY[] = [start, ...waypoints.map(([x, y]) => [start[0] + x, start[1] + y] as XY)];
  return (t) => {
    let left = Math.max(0, t) * speed;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const leg = Math.hypot(bx - ax, by - ay);
      if (left <= leg) return [ax + ((bx - ax) * left) / leg, ay + ((by - ay) * left) / leg];
      left -= leg;
    }
    return pts[pts.length - 1];
  };
}

/** Runs to a spot and holds it. */
const drop = (from: XY, to: XY, speed = 6) => route(from, [[to[0] - from[0], to[1] - from[1]]], speed);

/** Man: from his alignment, closes on the receiver over the first second and then stays on him (a step inside, a yard off). */
function man(from: XY, receiver: (t: number) => XY, lag = 0.15): (t: number) => XY {
  return (t) => {
    const [rx, ry] = receiver(Math.max(0, t - lag));
    const [r0x, r0y] = receiver(0);
    const close = Math.min(1, Math.max(0, t) / 1.0);
    const inside = rx > 0 ? -0.8 : 0.8;
    const cx = (from[0] - r0x) * (1 - close) + inside * close;
    const cy = (from[1] - r0y) * (1 - close) + 1.0 * close;
    return [rx + cx, ry + cy];
  };
}

let seed = Number(process.env.COVSEED ?? 7);
const noise = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed / 2147483647 - 0.5) * 0.6;
};

function track(id: number, team: "offense" | "defense", at: (t: number) => XY): TrackedPlayer {
  const points: [number, number, number][] = [];
  for (let f = 0; f <= 4 * FPS; f++) {
    const t = f / FPS - 1;
    if (f > 2 && noise() > 0.24) continue; // about a tenth missing
    const [x, y] = at(t);
    points.push([Math.round((t + 1) * 1000) / 1000, x + noise(), y + noise()]);
  }
  const [sx, sy] = at(-1);
  return { id, team, start: [sx, sy], points };
}

// The offense. Linemen take a pass set a yard back; the quarterback drops.
const OL: XY[] = [[-2.4, -0.8], [-1.2, -0.8], [0, -0.8], [1.2, -0.8], [2.4, -0.8]];
const X0: XY = [-18, -0.5];
const F0: XY = [-9, -1.2];
const Y0: XY = [9, -1.2];
const Z0: XY = [18, -0.5];
const H0: XY = [1.5, -5];

interface Routes {
  X: XY[];
  F: XY[];
  Y: XY[];
  Z: XY[];
  H: XY[];
}

/** Mesh-ish: X go, the slots drag across under each other, Z an out, the back to the flat. */
const MESH: Routes = { X: [[0, 20]], F: [[0, 3], [18, 5]], Y: [[0, 2], [-18, 4]], Z: [[0, 10], [5, 10]], H: [[6, 2], [8, 6]] };
/** Four verticals with the back swinging out. */
const VERTS: Routes = { X: [[0, 20]], F: [[-1, 20]], Y: [[1, 20]], Z: [[0, 20]], H: [[7, 1], [10, 4]] };

function offense(r: Routes) {
  const paths = {
    X: route(X0, r.X),
    F: route(F0, r.F),
    Y: route(Y0, r.Y),
    Z: route(Z0, r.Z),
    H: route(H0, r.H),
  };
  const tracks: TrackedPlayer[] = [
    ...OL.map((p, i) => track(i, "offense", drop(p, [p[0], p[1] - 1], 3))),
    track(5, "offense", drop([0, -4.5], [0, -7], 4)),
    track(6, "offense", paths.X),
    track(7, "offense", paths.F),
    track(8, "offense", paths.Y),
    track(9, "offense", paths.Z),
    track(10, "offense", paths.H),
  ];
  return { paths, tracks };
}

// The defense's alignment: four down, two backers, a nickel over Y, corners over the #1s, and the safeties.
const DL: XY[] = [[-3.2, 1], [-1, 1], [1, 1], [3.2, 1]];
const WILL: XY = [-2, 5];
const MIKE: XY = [2, 5];
const NICKEL: XY = [9, 5];
const CB_L: XY = [-18, 7];
const CB_R: XY = [18, 7];
const TWO_HIGH: [XY, XY] = [[-9, 12], [9, 12]];
const ONE_HIGH: [XY, XY] = [[-8, 6], [0, 13]]; // SS walked down over F, FS in the middle

const rush = (p: XY) => drop(p, [p[0], -2], 4);

function play(r: Routes, defense: (o: ReturnType<typeof offense>["paths"]) => ((t: number) => XY)[]): TrackedPlayFile {
  const o = offense(r);
  const d = [...DL.map(rush), ...defense(o.paths)];
  return { tracks: [...o.tracks, ...d.map((at, i) => track(100 + i, "defense", at))] };
}

describe("readCoverage on drawn plays", () => {
  it("Cover 1: everyone underneath runs with his man, one safety deep in the middle", () => {
    const file = play(MESH, (o) => [
      man(CB_L, o.X), man(CB_R, o.Z), man(NICKEL, o.Y), man(ONE_HIGH[0], o.F), man(MIKE, o.H),
      rush(WILL), drop(ONE_HIGH[1], [0, 16]),
    ]);
    const read = readCoverage(file)!;
    expect(read.label).toBe("COVER 1");
    expect(read.man).toBe(true);
    expect(read.sure).toBe(true);
  });

  it("Cover 0: man everywhere, both backers come, nobody deep", () => {
    const file = play(MESH, (o) => [
      man(CB_L, o.X), man(CB_R, o.Z), man(NICKEL, o.Y), man(ONE_HIGH[0], o.F), man(ONE_HIGH[1], o.H),
      rush(WILL), rush(MIKE),
    ]);
    expect(readCoverage(file)!.label).toBe("COVER 0");
  });

  it("2 Man: man underneath with two deep halves", () => {
    const file = play(MESH, (o) => [
      man(CB_L, o.X), man(CB_R, o.Z), man(NICKEL, o.Y), man(WILL, o.F), man(MIKE, o.H),
      drop(TWO_HIGH[0], [-11, 17]), drop(TWO_HIGH[1], [11, 17]),
    ]);
    expect(readCoverage(file)!.label).toBe("2 MAN");
  });

  it("Cover 2: corners sit in the flats, two deep halves, the drags run through the backers", () => {
    const file = play(MESH, () => [
      drop(CB_L, [-15, 4]), drop(CB_R, [15, 4]), drop(NICKEL, [8, 8]), drop(WILL, [-4, 8]), drop(MIKE, [3, 8]),
      drop(TWO_HIGH[0], [-11, 17]), drop(TWO_HIGH[1], [11, 17]),
    ]);
    const read = readCoverage(file)!;
    expect(read.label).toBe("COVER 2");
    expect(read.man).toBe(false);
    expect(read.flats).toEqual({ left: "cloud", right: "cloud" });
  });

  it("Tampa 2: Cover 2 with the middle backer running the deep middle", () => {
    const file = play(MESH, () => [
      drop(CB_L, [-15, 4]), drop(CB_R, [15, 4]), drop(NICKEL, [8, 8]), drop(WILL, [-4, 8]), drop(MIKE, [0, 14], 7),
      drop(TWO_HIGH[0], [-11, 17]), drop(TWO_HIGH[1], [11, 17]),
    ]);
    expect(readCoverage(file)!.label).toBe("TAMPA 2");
  });

  it("Cover 3 sky, rotated out of two high: the free safety spins to the middle, the strong safety rolls down to the flat", () => {
    const file = play(MESH, () => [
      drop(CB_L, [-17, 15]), drop(CB_R, [17, 15]), drop(NICKEL, [6, 8]), drop(WILL, [-4, 8]), drop(MIKE, [1, 8]),
      drop(TWO_HIGH[0], [0, 16], 7), drop(TWO_HIGH[1], [12, 5]),
    ]);
    const read = readCoverage(file)!;
    expect(read.label).toBe("COVER 3 SKY");
    expect(read.shell).toBe("2-high");
    expect(read.rotated).toBe(true);
    expect(read.flats.right).toBe("sky");
  });

  it("Cover 3 cloud: a corner squats in the flat and his safety takes the deep third over him", () => {
    const file = play(MESH, () => [
      drop(CB_L, [-15, 4]), drop(CB_R, [17, 15]), drop(NICKEL, [6, 8]), drop(WILL, [-4, 8]), drop(MIKE, [1, 8]),
      drop(TWO_HIGH[0], [-17, 16], 7), drop(TWO_HIGH[1], [0, 16], 7),
    ]);
    const read = readCoverage(file)!;
    expect(read.label).toBe("COVER 3 CLOUD");
    expect(read.flats.left).toBe("cloud");
  });

  it("Cover 4 match: the corners bail, the safeties carry the #2s up the seams", () => {
    const file = play(VERTS, (o) => [
      drop(CB_L, [-16, 15]), drop(CB_R, [16, 15]), drop(NICKEL, [6, 8]), drop(WILL, [-4, 8]), drop(MIKE, [3, 8]),
      man(TWO_HIGH[0], o.F, 0.1), man(TWO_HIGH[1], o.Y, 0.1),
    ]);
    const read = readCoverage(file)!;
    expect(read.label).toBe("COVER 4 MATCH");
    expect(read.deep).toBe(4);
  });

  it("Cover 4 spot drop: the safeties sit in their quarters and let the seams go by", () => {
    const seams: Routes = { ...VERTS, F: [[-1, 20]], Y: [[1, 20]] };
    const file = play(seams, () => [
      drop(CB_L, [-16, 15]), drop(CB_R, [16, 15]), drop(NICKEL, [6, 8]), drop(WILL, [-4, 8]), drop(MIKE, [3, 8]),
      drop(TWO_HIGH[0], [-4, 13]), drop(TWO_HIGH[1], [4, 13]),
    ]);
    const read = readCoverage(file)!;
    expect(read.label).toBe("COVER 4");
    expect(read.match).toBe(false);
  });

  it("Cover 6: quarters to the right, the left corner squats and his safety takes the half", () => {
    const file = play(MESH, () => [
      drop(CB_L, [-15, 4]), drop(CB_R, [16, 15]), drop(NICKEL, [6, 8]), drop(WILL, [-4, 8]), drop(MIKE, [3, 8]),
      drop(TWO_HIGH[0], [-12, 17]), drop(TWO_HIGH[1], [7, 14]),
    ]);
    expect(readCoverage(file)!.label).toBe("COVER 6");
  });

  it("says nothing when too few defenders were followed through the play", () => {
    const file = play(MESH, () => [drop(CB_L, [-15, 4]), drop(CB_R, [15, 4])]);
    expect(readCoverage(file)).toBeNull();
  });

  it("is unsure when no route broke across a defender (four verticals): man and zone look alike", () => {
    const file = play({ ...VERTS, H: [[0, -1]] }, () => [
      drop(CB_L, [-17, 15]), drop(CB_R, [17, 15]), drop(NICKEL, [6, 8]), drop(WILL, [-4, 8]), drop(MIKE, [1, 8]),
      drop(TWO_HIGH[0], [0, 16], 7), drop(TWO_HIGH[1], [12, 5]),
    ]);
    expect(readCoverage(file)!.sure).toBe(false);
  });
});

describe("when the men being read aren't the defense's eleven", () => {
  it("is never sure if the defense at the snap doesn't add up (the line not found, as on the low sideline film)", () => {
    const o = offense(MESH);
    const backEight = [
      drop(CB_L, [-15, 4]), drop(CB_R, [15, 4]), drop(NICKEL, [8, 8]), drop(WILL, [-4, 8]), drop(MIKE, [3, 8]),
      drop(TWO_HIGH[0], [-11, 17]), drop(TWO_HIGH[1], [11, 17]),
    ];
    const file = { tracks: [...o.tracks, ...backEight.map((at, i) => track(200 + i, "defense", at))] };
    const read = readCoverage(file)!;
    expect(read.label).toBe("COVER 2");
    expect(read.sure).toBe(false);
    expect(read.evidence.join(" ")).toContain("doesn't add up");
  });
});

describe("coverage tags", () => {
  it("reads a sheet's COVERAGE into a family", () => {
    expect(coverageFamilyOf("C3")).toBe("3");
    expect(coverageFamilyOf("Cover 3 Sky")).toBe("3");
    expect(coverageFamilyOf("COVER 1")).toBe("1");
    expect(coverageFamilyOf("Quarters")).toBe("4");
    expect(coverageFamilyOf("Tampa 2")).toBe("tampa-2");
    expect(coverageFamilyOf("2 Man")).toBe("2-man");
    expect(coverageFamilyOf("6 - DOUBLE FIRE")).toBe("6");
    expect(coverageFamilyOf("")).toBeNull();
  });

  it("writes a sure read on a card with no coverage tagged, and never over the coach's", () => {
    const [blank, tagged] = parseHudlCsvText("PLAY #,OFF FORM,OFF PLAY,COVERAGE\n1,DUCES,MESH,\n2,DUCES,MESH,COVER 2\n").cards;
    const read = readCoverage(
      play(MESH, (o) => [
        man(CB_L, o.X), man(CB_R, o.Z), man(NICKEL, o.Y), man(ONE_HIGH[0], o.F), man(MIKE, o.H),
        rush(WILL), drop(ONE_HIGH[1], [0, 16]),
      ]),
    );
    expect(applyCoverageRead(blank, read).coverage).toBe("COVER 1");
    expect(applyCoverageRead(blank, read).notes).toContain("Film coverage: COVER 1.");
    expect(applyCoverageRead(tagged, read).coverage).toBe("COVER 2");
  });
});

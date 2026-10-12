import { describe, expect, it } from "vitest";
import { buildDiagram, FIELD, routeTemplateYards, YARD_PX, YARD_X, type RouteKind } from "./formations";
import { parseHudlCsvText } from "./hudlParser";
import { cardFromTracks, type TrackedPlayer, type TrackedPlayFile } from "./trackedPlay";
import { MIN_AGREEING_MEN, groupViews, mergeAll, mergeViews } from "./viewMerge";

const CSV = "PLAY #,DN,DIST,OFF FORM,OFF PLAY,PLAY TYPE,OFF STR,PLAY DIR\n1,1,10,Spread,QUICK SLANT,Pass,R,R\n";

function walk(kind: RouteKind, start: [number, number], outside: 1 | -1): [number, number, number][] {
  const shape = routeTemplateYards(kind, 1);
  const pts: [number, number, number][] = [];
  let t = 0;
  let prev: [number, number] | null = null;
  const at = (x: number, y: number) => {
    if (prev) t += Math.hypot(x - prev[0], y - prev[1]) / 7;
    prev = [x, y];
    pts.push([t, x, y]);
  };
  for (let i = 0; i < shape.length - 1; i++) {
    for (let k = 0; k < 8; k++) {
      const f = k / 8;
      at(start[0] + (shape[i][0] + (shape[i + 1][0] - shape[i][0]) * f) * outside, start[1] + shape[i][1] + (shape[i + 1][1] - shape[i][1]) * f);
    }
  }
  const last = shape[shape.length - 1];
  at(start[0] + last[0] * outside, start[1] + last[1]);
  return pts;
}

/** The true play: the card's own offense (two skill men run routes) and eleven defenders on the other side of the ball. */
function truth(routes: Record<string, RouteKind>) {
  const row = parseHudlCsvText(CSV).cards[0];
  const spots = buildDiagram({ ...row, hash: null }, "team", "offense").players;
  const offense: TrackedPlayer[] = spots.map((p, id) => {
    const start: [number, number] = [(p.x - FIELD.center.x) / YARD_X, (FIELD.los - p.y) / YARD_PX];
    const kind = p.label ? routes[p.label] : undefined;
    const points = kind ? walk(kind, start, start[0] < 0 ? -1 : 1) : Array.from({ length: 12 }, (_, i) => [i / 10, start[0], start[1]] as [number, number, number]);
    return { id, team: "offense", start, points };
  });
  const defense: TrackedPlayer[] = Array.from({ length: 11 }, (_, i) => {
    const start: [number, number] = [-15 + i * 3, 1.5 + (i % 3) * 3];
    return { id: 100 + i, team: "defense", start, points: [[0, start[0], start[1]], [1, start[0], start[1] + 2]] };
  });
  return { row, row2: row, offense, defense, spots };
}

/** What one camera makes of a track: shifted by where it puts the ball, with a little noise, optionally cut off. */
function seen(t: TrackedPlayer, shift: [number, number], seed: number, endAt = Infinity, idOffset = 0): TrackedPlayer {
  const noise = (k: number) => Math.sin(seed * 7.1 + k * 3.7) * 0.12;
  const points = t.points.filter(([s]) => s <= endAt).map(([s, x, y], k) => [s, x + shift[0] + noise(k), y + shift[1] + noise(k + 50)] as [number, number, number]);
  const start: [number, number] = [t.start[0] + shift[0], t.start[1] + shift[1]];
  return { ...t, id: t.id + idOffset, start, points };
}

const file = (tracks: TrackedPlayer[]): TrackedPlayFile => ({ tracks });

describe("mergeViews", () => {
  const letters = () => {
    const row = parseHudlCsvText(CSV).cards[0];
    return buildDiagram({ ...row, hash: null }, "team", "offense").players.filter((p) => p.label && p.label !== "Q");
  };

  it("recovers a receiver one camera lost, from the other, so his route can be read", () => {
    const [a, b] = letters();
    const t = truth({ [a.label]: "post", [b.label]: "out" });
    const idA = t.spots.findIndex((p) => p.label === a.label);
    const idB = t.spots.findIndex((p) => p.label === b.label);
    // The press box loses the post man at 0.6 s (a defender covers him) and sees the rest; the end zone has a shift in
    // where it puts the ball and loses the out man instead.
    const press = file([...t.offense, ...t.defense].map((p) => seen(p, [0, 0], 1, p.id === idA ? 0.6 : Infinity)));
    const endZone = file([...t.offense, ...t.defense].map((p) => seen(p, [0.6, -0.4], 2, p.id === idB ? 1.0 : Infinity, 200)));

    // Alone, the press box can't read his route (a path under 5 yards is "unknown", not a guess).
    const alone = cardFromTracks(press, t.row);
    expect(alone.reads.find((r) => r.letter === a.label)?.kind).toBe("unknown");

    const { file: merged, report } = mergeViews(press, endZone);
    expect(report.used).toBe(true);
    expect(report.matched).toBe(22);
    expect(report.extended).toBeGreaterThanOrEqual(1);
    expect(report.shift[0]).toBeCloseTo(0.6, 1);
    expect(report.shift[1]).toBeCloseTo(-0.4, 1);

    const read = cardFromTracks(merged, t.row);
    expect(read.reads.find((r) => r.letter === a.label)?.kind).toBe("post");
    expect(read.reads.find((r) => r.letter === b.label)?.kind).toBe("out"); // the press box had this one whole
    expect(merged.tracks).toHaveLength(22); // nobody counted twice
    // the joined path is in the first view's frame: it ends where the post goes, not 0.6 yards off it
    const post = merged.tracks.find((x) => x.id === idA)!;
    const full = t.offense[idA].points.at(-1)!;
    const end = post.points.at(-1)!;
    expect(Math.hypot(end[1] - full[1], end[2] - full[2])).toBeLessThan(0.4);
  });

  it("adds a man only the second view found, where players stand, and only up to a team", () => {
    const t = truth({});
    const press = file([...t.offense, ...t.defense.slice(0, 9)].map((p) => seen(p, [0, 0], 1)));
    const endZone = file([...t.offense, ...t.defense].map((p) => seen(p, [0.3, 0.2], 2, Infinity, 200)));
    const { file: merged, report } = mergeViews(press, endZone);
    expect(report.added).toBe(2);
    expect(merged.tracks.filter((x) => x.team === "defense")).toHaveLength(11);
    expect(new Set(merged.tracks.map((x) => x.id)).size).toBe(merged.tracks.length); // fresh ids
  });

  it("does not add more than eleven to a side, nor people standing off the field", () => {
    const t = truth({});
    const press = file([...t.offense, ...t.defense].map((p) => seen(p, [0, 0], 1)));
    const ghosts: TrackedPlayer[] = [
      { id: 300, team: "offense", start: [5, 0], points: [[0, 5, 0], [1, 5, 3]] }, // a twelfth offensive man
      { id: 301, team: "defense", start: [45, 4], points: [[0, 45, 4], [1, 45, 5]] }, // the bench
      { id: 302, team: "defense", start: [3, -30], points: [[0, 3, -30], [1, 3, -29]] }, // the stands behind the offense
    ];
    const endZone = file([...[...t.offense, ...t.defense].map((p) => seen(p, [0, 0], 2, Infinity, 200)), ...ghosts]);
    const { file: merged, report } = mergeViews(press, endZone);
    expect(report.added).toBe(0);
    expect(merged.tracks).toHaveLength(22);
  });

  it("leaves the second view out when it doesn't show the same play", () => {
    const t = truth({});
    const press = file([...t.offense, ...t.defense].map((p) => seen(p, [0, 0], 1)));
    // a different formation entirely: people scattered where the first view has nobody
    const elsewhere = file(
      [...t.offense, ...t.defense].map((p, i) => seen({ ...p, start: [p.start[0] + 12 + (i % 5), p.start[1] + 9], points: p.points.map(([s, x, y]) => [s, x + 12 + (i % 5), y + 9] as [number, number, number]) }, [0, 0], 3, Infinity, 200)),
    );
    const { file: merged, report } = mergeViews(press, elsewhere);
    expect(report.used).toBe(false);
    expect(report.matched).toBeLessThan(MIN_AGREEING_MEN);
    expect(merged).toBe(press);
  });

  it("takes the second view alone when the first found nobody, and the first alone when the second did", () => {
    const t = truth({});
    const all = file([...t.offense, ...t.defense]);
    expect(mergeViews(file([]), all).file.tracks).toHaveLength(22);
    expect(mergeViews(all, file([])).file).toBe(all);
  });

  it("doesn't join a track that doesn't pick up where the first one left off", () => {
    const [a] = letters();
    const t = truth({ [a.label]: "go" });
    const id = t.spots.findIndex((p) => p.label === a.label);
    const press = file([...t.offense, ...t.defense].map((p) => seen(p, [0, 0], 1, p.id === id ? 1.0 : Infinity)));
    // the second view's track for him runs somewhere else after 1 s (it handed him off to another man)
    const endZone = file(
      [...t.offense, ...t.defense].map((p) => {
        const s = seen(p, [0, 0], 2, Infinity, 200);
        return p.id === id ? { ...s, points: s.points.map(([time, x, y]) => (time > 1.0 ? [time, x + 12, y] : [time, x, y]) as [number, number, number]) } : s;
      }),
    );
    const { file: merged, report } = mergeViews(press, endZone);
    expect(report.extended).toBe(0);
    expect(merged.tracks.find((x) => x.id === id)!.points.at(-1)![0]).toBeLessThanOrEqual(1.0 + 1e-9);
  });

  it("folds three angles", () => {
    const t = truth({});
    const view = (shift: [number, number], seed: number, idOff: number) => file([...t.offense, ...t.defense].map((p) => seen(p, shift, seed, Infinity, idOff)));
    const { file: merged, reports } = mergeAll([view([0, 0], 1, 0), view([0.4, 0], 2, 200), view([-0.3, 0.3], 3, 400)]);
    expect(reports.map((r) => r.used)).toEqual([true, true]);
    expect(merged.tracks).toHaveLength(22);
  });
});

describe("groupViews", () => {
  it("groups a play's views by name, the first angle first", () => {
    const g = groupViews(["play_002_b.json", "play_001.json", "play_002.json", "play_001_b.json", "play_001_c.json", "play_003.json"]);
    expect([...g]).toEqual([
      ["play_002.json", ["play_002.json", "play_002_b.json"]],
      ["play_001.json", ["play_001.json", "play_001_b.json", "play_001_c.json"]],
      ["play_003.json", ["play_003.json"]],
    ]);
  });

  it("keeps a play whose first angle is missing, and ordinary names, as they are", () => {
    const g = groupViews(["play_005_b.json", "clip_a.json", "game_b2.json"]);
    expect([...g.keys()].sort()).toEqual(["clip_a.json", "game_b2.json", "play_005.json"]);
    expect(g.get("play_005.json")).toEqual(["play_005_b.json"]);
  });
});

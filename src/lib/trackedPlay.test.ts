import { describe, expect, it } from "vitest";
import { buildDiagram, FIELD, routeTemplateYards, YARD_PX, YARD_X, type RouteKind } from "./formations";
import { parseHudlCsvText, updateCard } from "./hudlParser";
import { cardFromTracks, detectionFromTracks, fromTheSnap, snapTime, trimAtJump, type TrackedPlayer, type TrackedPlayFile } from "./trackedPlay";

const CSV = "PLAY #,DN,DIST,OFF FORM,OFF PLAY,PLAY TYPE,OFF STR,PLAY DIR\n1,1,10,Spread,QUICK SLANT,Pass,R,R\n";

/** Walks a route's diagram in yards, from his spot, on his own side of the ball. */
function walk(kind: RouteKind, start: [number, number], outside: 1 | -1): [number, number, number][] {
  const shape = routeTemplateYards(kind, 1);
  const pts: [number, number, number][] = [];
  let t = 0;
  let prev: [number, number] | null = null;
  // Run it at a real speed (7 yards a second), so the timing is one a player could have.
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

/** A tracked play for the card's own formation: every skill man runs what `routes` says, linemen and Q stay. */
function played(routes: Record<string, RouteKind>) {
  const row = parseHudlCsvText(CSV).cards[0];
  const spots = buildDiagram({ ...row, hash: null }, "team", "offense").players;
  const tracks: TrackedPlayer[] = spots.map((p, id) => {
    const start: [number, number] = [(p.x - FIELD.center.x) / YARD_X, (FIELD.los - p.y) / YARD_PX];
    const kind = p.label ? routes[p.label] : undefined;
    const points = kind
      ? walk(kind, start, start[0] < 0 ? -1 : 1)
      : Array.from({ length: 12 }, (_, i) => [i / 10, start[0], start[1]] as [number, number, number]);
    return { id, team: "offense", start, points };
  });
  // Someone on defense, who must be ignored.
  tracks.push({ id: 99, team: "defense", start: [3, 5], points: [[0, 3, 5], [1, 3, 9]] });
  return { row, spots, file: { tracks } satisfies TrackedPlayFile };
}

describe("cardFromTracks", () => {
  it("puts each tracked man's route on his own letter, read from where he went", () => {
    const row = parseHudlCsvText(CSV).cards[0];
    const letters = buildDiagram({ ...row, hash: null }, "team", "offense").players.filter((p) => p.label && p.label !== "Q");
    const [a, b] = letters; // two skill players, whoever they are in a Spread
    const want: Record<string, RouteKind> = { [a.label]: "post", [b.label]: "out" };
    const { file } = played(want);
    const { card, reads } = cardFromTracks(file, row, { trustFilmRoutes: true });
    expect(card.routeOverrides?.[a.label]?.route).toBe("post");
    expect(card.routeOverrides?.[b.label]?.route).toBe("out");
    expect(card.routeOverrides?.[a.label]?.source).toBe("video");
    expect(reads.find((r) => r.letter === a.label)?.kind).toBe("post");
    // The sheet stays ground truth.
    expect(card.playCall).toBe("QUICK SLANT");
    expect(card.down).toBe(1);
  });

  it("by default keeps the sheet's call as the routes and only lists what the film read (film routes are unproven on real plays)", () => {
    const row = parseHudlCsvText(CSV).cards[0];
    const letters = buildDiagram({ ...row, hash: null }, "team", "offense").players.filter((p) => p.label && p.label !== "Q");
    const [a, b] = letters;
    const { file } = played({ [a.label]: "post", [b.label]: "out" });
    const { card, reads } = cardFromTracks(file, row);
    expect(Object.values(card.routeOverrides ?? {}).some((r) => r?.source === "video")).toBe(false);
    expect(card.notes).toContain("not drawn");
    expect(card.notes).toContain(`${a.label} post`);
    expect(reads.find((r) => r.letter === a.label)?.kind).toBe("post"); // the read itself is still there for scoring
    // What the film saw is kept beside the routes for Edit play's "Use the film route", with how sure it was.
    expect(card.filmRoutes?.[a.label]?.route).toBe("post");
    expect(card.filmRoutes?.[a.label]?.path?.length).toBeGreaterThan(1);
    expect(typeof card.filmRoutes?.[a.label]?.confidence).toBe("number");
    expect(card.filmRoutes?.[b.label]?.route).toBe("out");
    // Taking it is the coach's copy into routeOverrides, and then it draws.
    const taken = updateCard(card, { routeOverrides: { [a.label]: { route: card.filmRoutes![a.label].route, path: card.filmRoutes![a.label].path, source: "video" } } });
    expect(taken.routeOverrides?.[a.label]?.source).toBe("video");
    expect(taken.filmRoutes?.[a.label]).toBeDefined();
    // Film only, no sheet: the read is drawn but every route is called unchecked.
    const film = cardFromTracks(file, null, { formation: "Spread" });
    expect(film.card.notes).toContain("unchecked");
  });

  it("leaves linemen, the quarterback and the defense out of the routes", () => {
    const { file, row } = played({});
    const { card } = cardFromTracks(file, row);
    expect(card.routeOverrides?.Q).toBeUndefined();
    for (const r of Object.values(card.routeOverrides ?? {})) expect(r?.route).toBe("stalk");
  });

  it("flags a path no route fits on the card for a coach", () => {
    const row = parseHudlCsvText(CSV).cards[0];
    const [a] = buildDiagram({ ...row, hash: null }, "team", "offense").players.filter((p) => p.label && p.label !== "Q");
    const { file } = played({});
    const wander = file.tracks.find((t) => Math.abs(t.start[0] - (a.x - FIELD.center.x) / YARD_X) < 0.2 && Math.abs(t.start[1] - (FIELD.los - a.y) / YARD_PX) < 0.2)!;
    wander.points = Array.from({ length: 30 }, (_, i) => [i * 0.5, wander.start[0] + Math.sin(i / 2) * 9, wander.start[1] + 8 - i * 0.5]);
    const { card, unsure } = cardFromTracks(file, row, { trustFilmRoutes: true });
    expect(unsure.some((u) => u.kind === "unknown")).toBe(true);
    expect(card.notes).toContain("Check routes");
  });

  it("builds a card with no sheet row from the formation the pre-snap reader named", () => {
    const { file } = played({});
    const { card } = cardFromTracks(file, null, { formation: "Spread", source: "game1" });
    expect(card.formationKey).toBe("spread");
    expect(card.source).toBe("game1");
  });
});

describe("a tracked game as a file", () => {
  it("round-trips through parseScriptFile, and refuses anything else", async () => {
    const { parseScriptFile } = await import("./scriptStore");
    const { file, row } = played({});
    const { card } = cardFromTracks(file, row);
    const text = JSON.stringify({ fileName: "g.csv", films: ["g.csv"], savedAt: "", cards: [card], warnings: [] });
    const script = parseScriptFile(text);
    expect(script?.cards).toHaveLength(1);
    expect(script?.cards[0].playCall).toBe("QUICK SLANT");
    expect(parseScriptFile("{}")).toBeNull();
    expect(parseScriptFile("not json")).toBeNull();
    expect(parseScriptFile(JSON.stringify({ cards: [{ nope: 1 }] }))).toBeNull();
  });
});

describe("snapTime and fromTheSnap", () => {
  const still = (id: number, x: number, y: number, until: number, then: [number, number]): TrackedPlayer => ({
    id,
    team: "offense",
    start: [x, y],
    points: Array.from({ length: 60 }, (_, i) => {
      const t = i / 10;
      const k = Math.max(0, t - until);
      return [t, x + then[0] * k, y + then[1] * k] as [number, number, number];
    }),
  });

  it("finds the snap as the time the fourth man starts to move, not a man in motion", () => {
    const file: TrackedPlayFile = {
      tracks: [
        still(1, -10, -1, 1.0, [0, 3]), // motion man, early, alone
        still(2, 0, -5, 3.0, [0, 4]),
        still(3, 10, 0, 3.0, [1, 4]),
        still(4, 14, -1, 3.1, [0, 5]),
      ],
    };
    const at = snapTime(file);
    expect(at).toBeGreaterThan(2.7);
    expect(at).toBeLessThan(3.2);
  });

  it("starts every route from the snap, with the pre-snap standing time cut off", () => {
    const file: TrackedPlayFile = {
      tracks: [still(1, 10, 0, 3.0, [0, 6]), still(2, 14, 0, 3.0, [0, 6]), still(3, -10, 0, 3.0, [0, 6]), still(4, 0, -5, 3.0, [0, 4])],
    };
    const cut = fromTheSnap(file);
    expect(cut.tracks[0].points[0][0]).toBeGreaterThan(2.7);
    expect(Math.abs(cut.tracks[0].start[1])).toBeLessThan(1.0);
  });
});

describe("a track the tracker handed to another man", () => {
  it("is cut off at the jump, not read as a route", () => {
    const cut = trimAtJump([
      [0, 0, 0], [0.1, 0.3, 0.8], [0.2, 0.5, 1.6], [0.3, 0.8, 2.4], [0.4, 1.0, 3.2],
      [0.5, 9.0, 12.0], [0.6, 9.2, 12.8], [0.7, 9.4, 13.6],
    ]);
    expect(cut).toHaveLength(5);
    expect(trimAtJump([[0, 0, 0], [0.5, 0, 3], [1, 0, 6]])).toHaveLength(3);
    // Missed for two-thirds of a second, then found 9 yards away: someone else.
    expect(trimAtJump([[0, 0, 0], [0.1, 0.2, 0.5], [0.77, 0.4, 9.8], [0.83, 0.4, 10.2]])).toHaveLength(2);
    // Missed for the same time, found 5 yards on: a sprint.
    expect(trimAtJump([[0, 0, 0], [0.1, 0.2, 0.5], [0.77, 0.4, 5.2], [0.83, 0.4, 5.6]])).toHaveLength(4);
  });

  it("reads a path that ended before the route showed as unclear, not as a guess", () => {
    const row = parseHudlCsvText(CSV).cards[0];
    const [a] = buildDiagram({ ...row, hash: null }, "team", "offense").players.filter((p) => p.label && p.label !== "Q");
    const { file } = played({});
    const man = file.tracks.find((t) => Math.abs(t.start[0] - (a.x - FIELD.center.x) / YARD_X) < 0.2 && Math.abs(t.start[1] - (FIELD.los - a.y) / YARD_PX) < 0.2)!;
    // Three yards out and lost: could be a hitch, a speed out, anything.
    man.points = Array.from({ length: 10 }, (_, i) => [i * 0.1, man.start[0] + i * 0.3, man.start[1] + i * 0.1]);
    const { unsure } = cardFromTracks(file, row);
    expect(unsure.some((u) => u.kind === "unknown")).toBe(true);
  });
});

describe("one man followed twice", () => {
  it("keeps the track that ran upfield, not a longer one that wandered along the line", () => {
    const { file } = played({ X: "go", Y: "go", Z: "go", H: "go" });
    // Two ids start 1.5 yards apart on the far right. One slid along the line (a bystander), the other ran a go.
    file.tracks.push({
      id: 200, team: "offense", start: [30, 0],
      points: Array.from({ length: 100 }, (_, i) => [i * 0.05, 30 - i * 0.2, 0] as [number, number, number]),
    });
    file.tracks.push({
      id: 201, team: "offense", start: [31.2, -0.8],
      points: Array.from({ length: 30 }, (_, i) => [i * 0.1, 31.2, -0.8 + i * 0.8] as [number, number, number]),
    });
    const { reads } = detectionFromTracks(file);
    const there = reads.filter((r) => Math.abs(r.player.start.x - 31.2) < 0.1 || Math.abs(r.player.start.x - 30) < 0.1);
    expect(there).toHaveLength(1);
    expect(there[0].player.start.x).toBeCloseTo(31.2);
  });
});

describe("snapTime when the formation shifts before the snap", () => {
  it("is when the line goes, not when men drifted 1.5 yd getting set", () => {
    // Four men shuffle 2 yd slowly between 1 s and 4 s (the formation setting up), then three start together at 5.0 s.
    const shuffle = (id: number, x: number) => ({
      id,
      team: "offense" as const,
      start: [x, 0] as [number, number],
      points: Array.from({ length: 181 }, (_, i) => {
        const t = i / 30;
        const drift = Math.min(1, Math.max(0, (t - 1) / 3)) * 2;
        return [t, x + drift, 0] as [number, number, number];
      }),
    });
    const go = (id: number, x: number) => ({
      id,
      team: "offense" as const,
      start: [x, 0] as [number, number],
      points: Array.from({ length: 241 }, (_, i) => {
        const t = i / 30;
        return [t, x, Math.max(0, t - 5.0) * 5] as [number, number, number];
      }),
    });
    const at = snapTime({ tracks: [shuffle(1, -10), shuffle(2, -8), shuffle(3, 8), shuffle(4, 10), go(5, -3), go(6, 0), go(7, 3)].map((t) => ({ ...t, points: t.points.slice(0, 240) })) });
    expect(at).toBeGreaterThan(4.5);
    expect(at).toBeLessThan(5.2);
  });
});

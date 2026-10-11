import { describe, expect, it } from "vitest";
import { buildDiagram, FIELD, routeTemplateYards, YARD_PX, YARD_X, type RouteKind } from "./formations";
import { parseHudlCsvText } from "./hudlParser";
import { cardFromTracks, type TrackedPlayer, type TrackedPlayFile } from "./trackedPlay";

const CSV = "PLAY #,DN,DIST,OFF FORM,OFF PLAY,PLAY TYPE,OFF STR,PLAY DIR\n1,1,10,Spread,QUICK SLANT,Pass,R,R\n";

/** Walks a route's diagram in yards, from his spot, on his own side of the ball. */
function walk(kind: RouteKind, start: [number, number], outside: 1 | -1): [number, number, number][] {
  const shape = routeTemplateYards(kind, 1);
  const pts: [number, number, number][] = [];
  let t = 0;
  for (let i = 0; i < shape.length - 1; i++) {
    for (let k = 0; k < 8; k++) {
      const f = k / 8;
      pts.push([t++ / 10, start[0] + (shape[i][0] + (shape[i + 1][0] - shape[i][0]) * f) * outside, start[1] + shape[i][1] + (shape[i + 1][1] - shape[i][1]) * f]);
    }
  }
  const last = shape[shape.length - 1];
  pts.push([t / 10, start[0] + last[0] * outside, start[1] + last[1]]);
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
    const { card, reads } = cardFromTracks(file, row);
    expect(card.routeOverrides?.[a.label]?.route).toBe("post");
    expect(card.routeOverrides?.[b.label]?.route).toBe("out");
    expect(card.routeOverrides?.[a.label]?.source).toBe("video");
    expect(reads.find((r) => r.letter === a.label)?.kind).toBe("post");
    // The sheet stays ground truth.
    expect(card.playCall).toBe("QUICK SLANT");
    expect(card.down).toBe(1);
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
    wander.points = Array.from({ length: 30 }, (_, i) => [i / 10, wander.start[0] + Math.sin(i / 2) * 9, wander.start[1] + 8 - i * 0.5]);
    const { card, unsure } = cardFromTracks(file, row);
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

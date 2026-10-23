import { describe, expect, it } from "vitest";
import { buildDiagram, FIELD, YARD_PX, YARD_X } from "./formations";
import { parseHudlCsvText } from "./hudlParser";
import { cardFromTracks, type TrackedPlayer, type TrackedPlayFile } from "./trackedPlay";

/*
 * A coach's taps (`eval/taps.py` writes `letter` on the tracks he tapped): a tapped man keeps his letter whatever the spots say, a track
 * nobody tapped is no receiver (a sideline coach in the team's color), and a man tapped with no path is said on the card.
 */
const CSV = "PLAY #,HASH,OFF FORM,OFF STR,OFF PLAY,PLAY TYPE,PLAY DIR\n3,M,DUCES,R,SLANT,Pass,R\n";
const row = () => parseHudlCsvText(CSV).cards[0];
const FPS = 30;

function track(id: number, start: [number, number], at: (t: number) => [number, number], extra: Partial<TrackedPlayer> = {}): TrackedPlayer {
  const points: [number, number, number][] = [];
  for (let f = 0; f <= 5 * FPS; f++) {
    const t = f / FPS;
    const [x, y] = at(t);
    points.push([t, x, y]);
  }
  return { id, team: "offense", start, points, ...extra };
}

/** The formation's own spots as tracks; every man steps upfield from 2.35 s (the snap is at 2.0 s). */
function play(letterAt: (label: string) => string | undefined, skip: string[] = []) {
  const spots = buildDiagram({ ...row(), hash: null }, "team", "offense").players.map((p) => ({
    label: p.label,
    start: [(p.x - FIELD.center.x) / YARD_X, (FIELD.los - p.y) / YARD_PX] as [number, number],
  }));
  const tracks = spots
    .filter((s) => !skip.includes(s.label))
    .map(({ label, start }, id) =>
      track(id, start, (t) => [start[0], start[1] + Math.max(0, t - 2.35) * 4], letterAt(label) ? { letter: letterAt(label) } : {}),
    );
  return { tracks, spots } satisfies { tracks: TrackedPlayer[]; spots: unknown };
}

describe("a coach's taps on film", () => {
  it("keeps the letter he tapped, even where the formation's own letters would say another", () => {
    // The staff taps the receivers as they see them: swap X and Z from what the spots would give.
    const swap: Record<string, string> = { X: "Z", Z: "X" };
    const { tracks, spots } = play((label) => swap[label] ?? (["F", "Y", "H", "Q"].includes(label) ? label : undefined));
    const file: TrackedPlayFile = { fps: FPS, tracks };
    const { card } = cardFromTracks(file, row(), { source: "taps" });
    const xSpot = spots.find((s) => s.label === "Z")!.start; // the man the coach tapped X stands where the formation puts Z
    expect(card.offenseSpots?.X?.x).toBeCloseTo(xSpot[0], 0);
    expect(card.offenseSpots?.X?.y).toBeCloseTo(xSpot[1], 0);
  });

  it("gives an untapped skill man no route once the coach has tapped the others", () => {
    const { tracks } = play((label) => (["X", "F", "Y", "H", "Q"].includes(label) ? label : undefined));
    // A track nobody tapped, split wide on the receivers' side (a coach on the sideline in the team's color), running up the field.
    tracks.push(track(99, [24, 0], (t) => [24, Math.max(0, t - 2.35) * 6]));
    const { card, reads } = cardFromTracks({ fps: FPS, tracks }, row(), { source: "taps" });
    expect(reads.map((r) => r.letter).sort()).toEqual(["F", "H", "X", "Y"]);
    expect(Object.keys(card.routeOverrides ?? {}).sort()).toEqual(["F", "H", "X", "Y"]);
  });

  it("says a tapped man the film has no path for", () => {
    const { tracks } = play((label) => (["X", "F", "Y", "Z", "Q"].includes(label) ? label : undefined));
    // Z is tapped but his track is lost before the snap: the film has two points of him, both before it.
    const z = tracks.find((t) => t.letter === "Z")!;
    z.points = z.points.filter(([t]) => t < 0.5);
    const { card } = cardFromTracks({ fps: FPS, tracks }, row(), { source: "taps" });
    expect(card.notes).toContain("Tapped, but the film has no path for: Z.");
  });

  it("says two men tapped on one box the film could not tell apart", () => {
    const { tracks } = play((label) => (["X", "F", "Y", "Z", "Q"].includes(label) ? label : undefined));
    tracks.find((t) => t.letter === "Y")!.alsoTapped = ["H"];
    const { card } = cardFromTracks({ fps: FPS, tracks }, row(), { source: "taps" });
    expect(card.notes).toContain("Tapped on one man the film couldn't tell apart: H (with Y).");
  });
});

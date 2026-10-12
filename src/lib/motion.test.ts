import { describe, expect, it } from "vitest";
import { buildDiagram, FIELD, YARD_PX, YARD_X } from "./formations";
import { parseHudlCsvText } from "./hudlParser";
import { cardFromTracks, detectionFromTracks, motionFromTrack, snapTime, type TrackedPlayer } from "./trackedPlay";
import { squigglePath } from "./squiggle";

/*
 * A play with five seconds of film: everyone set, one receiver (the right slot, Y) goes in motion across the formation
 * between 0.8 s and 1.8 s, and at 2.35 s four men start (the snap is 2.0 s). Everyone reads from that snap.
 */
const CSV = "PLAY #,HASH,OFF FORM,OFF STR,OFF PLAY,PLAY TYPE,PLAY DIR\n3,M,DUCES,R,SLANT,Pass,R\n";
const row = () => parseHudlCsvText(CSV).cards[0];
const FPS = 30;

function track(id: number, start: [number, number], at: (t: number) => [number, number], jitter = 0.15): TrackedPlayer {
  const points: [number, number, number][] = [];
  let k = 1;
  for (let f = 0; f <= 5 * FPS; f++) {
    const t = f / FPS;
    k = (k * 16807) % 2147483647;
    const [x, y] = at(t);
    points.push([t, x + ((k / 2147483647) - 0.5) * jitter * 2, y + (((k * 7) % 2147483647) / 2147483647 - 0.5) * jitter * 2]);
  }
  return { id, team: "offense", start, points };
}

function playWith(motion: ((t: number) => [number, number]) | null) {
  const spots = buildDiagram({ ...row(), hash: null }, "team", "offense").players.map((p) => ({
    label: p.label,
    start: [(p.x - FIELD.center.x) / YARD_X, (FIELD.los - p.y) / YARD_PX] as [number, number],
  }));
  const tracks: TrackedPlayer[] = spots.map(({ label, start }, id) => {
    const isY = label === "Y";
    if (isY && motion) return track(id, start, motion);
    // From 2.35 s the men are off at the snap: linemen and receivers step upfield.
    return track(id, start, (t) => [start[0], start[1] + Math.max(0, t - 2.35) * 4]);
  });
  return { tracks, spots } satisfies { tracks: TrackedPlayer[]; spots: unknown };
}

describe("pre-snap motion from film", () => {
  const yStart = (): [number, number] => {
    const { spots } = playWith(null);
    return spots.find((s) => s.label === "Y")!.start;
  };

  it("finds the snap from the four men who start, not the man in motion", () => {
    const [x0, y0] = yStart();
    const { tracks } = playWith((t) => [x0 - Math.min(Math.max(t - 0.8, 0), 1) * 7, y0]);
    expect(snapTime({ tracks })).toBeCloseTo(2.0, 0);
  });

  it("reads where the man was set before he went in motion", () => {
    const [x0, y0] = yStart();
    const { tracks } = playWith((t) => [x0 - Math.min(Math.max(t - 0.8, 0), 1) * 7, y0]);
    const y = tracks.find((t) => Math.abs(t.start[0] - x0) < 0.01 && Math.abs(t.start[1] - y0) < 0.01)!;
    const from = motionFromTrack(y, snapTime({ tracks }))!;
    expect(from.x).toBeCloseTo(x0, 0);
    expect(from.y).toBeCloseTo(y0, 0);
    // The detection carries it, and he is read from where he ended up.
    const { detection } = detectionFromTracks({ tracks });
    const moved = detection.players.filter((p) => p.motionFrom);
    expect(moved).toHaveLength(1);
    expect(moved[0].start.x).toBeCloseTo(x0 - 7, 0);
  });

  it("puts a squiggly line on the Scout O card from where he was set to his spot, on his own letter", () => {
    const [x0, y0] = yStart();
    const { tracks } = playWith((t) => [x0 - Math.min(Math.max(t - 0.8, 0), 1) * 7, y0]);
    const { card } = cardFromTracks({ tracks }, row());
    expect(Object.keys(card.motionFrom ?? {})).toHaveLength(1);
    const letter = Object.keys(card.motionFrom!)[0];
    const d = buildDiagram(card, "team", "offense");
    expect(d.motions).toHaveLength(1);
    const man = d.players.find((p) => p.label === letter)!;
    const [a, b] = d.motions[0];
    // The line ends on him and begins about seven yards away (across the formation).
    expect(Math.hypot(b.x - man.x, b.y - man.y)).toBeLessThan(1);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(5 * YARD_X);
    // And not on the defense's card.
    expect(buildDiagram(card, "team", "defense").motions).toEqual([]);
  });

  it("a set receiver and a man whose box only jittered a yard are not in motion", () => {
    const { tracks } = playWith(null);
    const snap = snapTime({ tracks });
    for (const t of tracks) expect(motionFromTrack(t, snap)).toBeNull();
    expect(detectionFromTracks({ tracks }).detection.players.every((p) => !p.motionFrom)).toBe(true);
    const { card } = cardFromTracks({ tracks }, row());
    expect(card.motionFrom).toBeUndefined();
  });

  it("a track that ran impossibly fast before the snap (it slid onto another man) is not motion", () => {
    const [x0, y0] = yStart();
    const { tracks } = playWith((t) => (t < 1.5 ? [x0, y0] : [x0 - 12, y0]));
    const y = tracks.find((t) => Math.abs(t.start[0] - x0) < 0.01 && Math.abs(t.start[1] - y0) < 0.01)!;
    expect(motionFromTrack(y, 2.0)).toBeNull();
  });

  it("needs film from before the snap", () => {
    const man: TrackedPlayer = { id: 1, team: "offense", start: [9, -1], points: [[0, 9, -1], [0.2, 4, -1], [0.4, 3, -1]] };
    expect(motionFromTrack(man, 0.3)).toBeNull();
  });

  it("is a wavy path that ends short of the player", () => {
    const d = squigglePath({ x: 100, y: 150 }, { x: 40, y: 150 }, 12);
    expect(d.startsWith("M 100.0 150.0")).toBe(true);
    expect((d.match(/Q/g) ?? []).length).toBeGreaterThanOrEqual(6);
    // Its last point is the gap short of the player (12 px), not on him.
    const last = d.trim().split(" ").slice(-2).map(Number);
    expect(last[0]).toBeCloseTo(52, 0);
  });
});


describe("the film's formation before and at the snap", () => {
  const f = (text: string, key: string) => ({ key, strength: null, staff: text, text, notes: "", men: 11 });
  const file = (set: string, snap: string) => {
    const { tracks } = playWith(null);
    return { tracks, formations: { set: f(set, "trips"), snap: f(snap, "spread"), snapSeconds: 2 } };
  };

  it("a card built from the film alone is the formation the ball was snapped from, and notes the motion", () => {
    const { card } = cardFromTracks(file("bunch gun right", "deuces gun"), null);
    expect(card.formation.toLowerCase()).toContain("deuces");
    expect(card.notes).toContain("Motion: set in Bunch Gun Right, snapped from Deuces Gun.");
  });

  it("no note when the formation did not change, and the sheet's formation stays the sheet's", () => {
    expect(cardFromTracks(file("deuces gun", "deuces gun"), null).card.notes).not.toContain("Motion:");
    const { card } = cardFromTracks(file("bunch gun right", "deuces gun"), row());
    expect(card.formation).toBe("DUCES");
  });
});

import { describe, expect, it } from "vitest";
import { buildAssignments, buildDiagram, FIELD } from "./formations";
import { parseHudlCsvText } from "./hudlParser";
import { isPressureTag, parsePressure, pressureTag } from "./pressure";
import { applyPressureRead, readPressure } from "./pressureRead";
import type { TrackedPlayer, TrackedPlayFile } from "./trackedPlay";

describe("the staff's blitz tags", () => {
  it("reads DOUBLE FIRE, FIRE and LB with the rush count", () => {
    expect(parsePressure("6 - DOUBLE FIRE")).toMatchObject({ rushers: 6, call: "DOUBLE FIRE", blitzers: ["outside-strong", "outside-weak"] });
    expect(parsePressure("5 - DOUBLE FIRE")?.rushers).toBe(5);
    expect(parsePressure("5 - FIRE")).toMatchObject({ rushers: 5, call: "FIRE", blitzers: ["outside-strong"] });
    expect(parsePressure("5 - FIRE")?.describe).toBe("Fire: an outside backer off the edge, 5 rush.");
    expect(parsePressure("5 - LB")).toMatchObject({ rushers: 5, call: "LB", blitzers: ["inside"] });
    expect(parsePressure("6 - DOUBLE FIRE")?.describe).toBe("Double Fire: both outside backers off the edge, 6 rush.");
  });

  it("tells a blitz from a coverage", () => {
    expect(isPressureTag("6 - DOUBLE FIRE")).toBe(true);
    expect(isPressureTag("5 - LB")).toBe(true);
    expect(isPressureTag("COVER 3")).toBe(false);
    expect(isPressureTag("C1")).toBe(false);
    expect(isPressureTag("")).toBe(false);
    expect(parsePressure("COVER 2")).toBeNull();
  });

  it("writes a tag back the way the staff does", () => {
    expect(pressureTag(6, ["outside-strong", "outside-weak"])).toBe("6 - DOUBLE FIRE");
    expect(pressureTag(5, ["outside-weak"])).toBe("5 - FIRE");
    expect(pressureTag(5, ["inside"])).toBe("5 - LB");
    expect(pressureTag(4, [])).toBeNull();
  });
});

const card = (coverage: string, front = "EVEN", str = "R") =>
  parseHudlCsvText(`PLAY #,OFF FORM,OFF STR,OFF PLAY,DEF FRONT,COVERAGE\n1,DUCES,${str},MESH,${front},${coverage}\n`).cards[0];

/** The defender each rush arrow starts from (by its label), on the card as drawn. */
function rushersOn(c: ReturnType<typeof card>, mode: "team" | "7v7" = "team") {
  const d = buildDiagram(c, mode, "defense");
  return d.rushes.map((path) => d.defense.find((p) => Math.hypot(p.x - path[0].x, p.y - path[0].y) < 0.5)?.label);
}

describe("the blitz on the Scout D card", () => {
  it("DOUBLE FIRE: both outside backers rush off the edge, at the quarterback", () => {
    const d = buildDiagram(card("6 - DOUBLE FIRE"), "team", "defense");
    expect(rushersOn(card("6 - DOUBLE FIRE")).sort()).toEqual(["S", "W"]);
    // Each crosses the line outside the tackle and finishes in the backfield (the card is turned: offense on top).
    for (const path of d.rushes) {
      expect(Math.abs(path[1].x - (d.ballHashX ?? FIELD.center.x))).toBeGreaterThan(40);
      expect(path[path.length - 1].y).toBeLessThan(d.losY);
    }
    expect(d.defenseNotes[0]).toContain("Double Fire");
  });

  it("FIRE: one outside backer (drawn from the strong side)", () => {
    expect(rushersOn(card("5 - FIRE"))).toEqual(["S"]);
  });

  it("LB: the backer nearest the ball, through the A gap", () => {
    expect(rushersOn(card("5 - LB"))).toEqual(["M"]);
  });

  it("no arrows for a coverage, or in 7v7 (no line to rush)", () => {
    expect(buildDiagram(card("COVER 3"), "team", "defense").rushes).toEqual([]);
    expect(rushersOn(card("6 - DOUBLE FIRE"), "7v7")).toEqual([]);
  });

  it("the table's box says BLITZ for a blitz call", () => {
    const c = card("6 - DOUBLE FIRE");
    const rows = buildAssignments(c, buildDiagram(c, "team", "defense"));
    expect(rows.find((r) => r.key === "COVERAGE")).toMatchObject({ label: "BLITZ:", text: "6 - DOUBLE FIRE" });
    const plain = card("COVER 3");
    expect(buildAssignments(plain, buildDiagram(plain, "team", "defense")).find((r) => r.key === "COVERAGE")?.label).toBe("COVERAGE:");
  });
});

/* Film: Duces against a 4-2-5 (two outside backers at +-5, a nickel over the right slot), 30 points a second. */
type XY = [number, number];
const FPS = 30;
function walk(from: XY, to: XY, speed: number): (t: number) => XY {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
  return (t) => {
    const f = Math.min(1, (Math.max(0, t) * speed) / (d || 1));
    return [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f];
  };
}
const stay = (p: XY) => walk(p, p, 1);
function track(id: number, team: "offense" | "defense", at: (t: number) => XY): TrackedPlayer {
  const points: [number, number, number][] = [];
  for (let f = 0; f <= 3 * FPS; f++) {
    const t = f / FPS - 1;
    const [x, y] = at(t);
    points.push([f / FPS, x, y]);
  }
  const [sx, sy] = at(-1);
  return { id, team, start: [sx, sy], points };
}
function offense(): TrackedPlayer[] {
  const line: XY[] = [[-2.4, -0.8], [-1.2, -0.8], [0, -0.8], [1.2, -0.8], [2.4, -0.8]];
  const skill: [XY, XY][] = [[[-18, -0.5], [-18, 14]], [[-9, -1.2], [-9, 10]], [[9, -1.2], [9, 10]], [[18, -0.5], [18, 14]], [[1.5, -5], [8, -3]]];
  return [
    ...line.map((p, i) => track(i, "offense", walk(p, [p[0], p[1] - 1], 3))),
    track(5, "offense", walk([0, -4.5], [0, -7], 4)),
    ...skill.map(([a, b], i) => track(6 + i, "offense", walk(a, b, 7))),
  ];
}
const DL: XY[] = [[-3.2, 1], [-1, 1], [1, 1], [3.2, 1]];
const WILL: XY = [-5, 5];
const MIKE: XY = [0, 5];
const NICKEL: XY = [9, 5];
const DBS: XY[] = [[-18, 7], [18, 7], [-9, 12], [9, 12]];
function defense(will: (t: number) => XY, mike: (t: number) => XY, nickel: (t: number) => XY, dlDrop = false): TrackedPlayer[] {
  return [
    ...DL.map((p, i) => track(100 + i, "defense", dlDrop && i === 0 ? walk(p, [p[0] - 3, 8], 5) : walk(p, [p[0], -2], 3))),
    track(110, "defense", will),
    track(111, "defense", mike),
    track(112, "defense", nickel),
    ...DBS.map((p, i) => track(120 + i, "defense", walk(p, [p[0], p[1] + 6], 5))),
  ];
}
const file = (d: TrackedPlayer[]): TrackedPlayFile => ({ tracks: [...offense(), ...d] });

describe("readPressure on drawn plays", () => {
  it("both outside backers off the edge: 6 - DOUBLE FIRE", () => {
    const read = readPressure(file(defense(walk(WILL, [-6, -3], 7), stay(MIKE), walk(NICKEL, [6, -3], 7))))!;
    expect(read.tag).toBe("6 - DOUBLE FIRE");
    expect(read.sure).toBe(true);
  });

  it("one off the edge: 5 - FIRE", () => {
    expect(readPressure(file(defense(walk(WILL, [-6, -3], 7), stay(MIKE), stay(NICKEL))))!.tag).toBe("5 - FIRE");
  });

  it("the middle backer through the A gap: 5 - LB", () => {
    expect(readPressure(file(defense(stay(WILL), walk(MIKE, [0.8, -3], 7), stay(NICKEL))))!.tag).toBe("5 - LB");
  });

  it("a straight four-man rush is no blitz", () => {
    expect(readPressure(file(defense(stay(WILL), stay(MIKE), stay(NICKEL))))!.tag).toBeNull();
  });

  it("a pressed corner already at the line is no blitz (first real film called one a \"4 - BLITZ\")", () => {
    const d = defense(stay(WILL), stay(MIKE), stay(NICKEL)).map((t) => (t.id === 120 ? track(120, "defense", walk([-18, 1.5], [-18, -4], 6)) : t));
    const read = readPressure(file(d))!;
    expect(read.tag).toBeNull();
    expect(read.blitzers).toEqual([]);
  });

  it("a down lineman who drops into coverage doesn't count as a rusher", () => {
    const read = readPressure(file(defense(walk(WILL, [-6, -3], 7), stay(MIKE), stay(NICKEL), true)))!;
    expect(read.rushers).toBe(4);
    expect(read.tag).toBe("4 - FIRE");
  });

  it("writes a sure blitz into a blank COVERAGE, and never over the coach's", () => {
    const read = readPressure(file(defense(walk(WILL, [-6, -3], 7), stay(MIKE), walk(NICKEL, [6, -3], 7))));
    const [blank, tagged] = parseHudlCsvText("PLAY #,OFF FORM,OFF PLAY,COVERAGE\n1,DUCES,MESH,\n2,DUCES,MESH,COVER 1\n").cards;
    expect(applyPressureRead(blank, read).coverage).toBe("6 - DOUBLE FIRE");
    expect(applyPressureRead(blank, read).notes).toContain("Film blitz: Double Fire");
    expect(applyPressureRead(tagged, read).coverage).toBe("COVER 1");
  });
});

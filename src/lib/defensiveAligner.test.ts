import { describe, expect, it } from "vitest";
import {
  alignDefense,
  coverageStyleFor,
  safetyY,
  splitReceivers,
  type AlignDefender,
  type CoverageStyle,
} from "./defensiveAligner";
import { buildDiagram, fromCardPoint, type Diagram } from "./formations";
import { parseHudlCsvText, type HudlPlayCard } from "./hudlParser";
import { defaultAlignment } from "./secondary";

const YARD_X = 500 / (160 / 3);
const depth = (y: number) => (140 - y) / 7;

function card(formation: string, coverage = "", front = "4-3"): HudlPlayCard {
  const csv = `PLAY #,OFF FORM,OFF PLAY,DEF FRONT,COVERAGE\n1,${formation},Slant,${front},${coverage}\n`;
  return parseHudlCsvText(csv).cards[0];
}

/** Defenders in the formation's own coordinates (un-flipped, no hash shift), by id. */
function spots(d: Diagram) {
  return Object.fromEntries(d.defense.map((p) => [p.id, fromCardPoint(d, p)]));
}

function receiverX(c: HudlPlayCard, label: string) {
  const p = buildDiagram(c, "team", "offense").players.find((pl) => pl.label === label)!;
  return p.x;
}

describe("splitReceivers", () => {
  it("numbers 2x2 Spread outside in on each side", () => {
    const skill = [
      { label: "X", x: 36, y: 150 },
      { label: "F", x: 112, y: 160 },
      { label: "Y", x: 388, y: 160 },
      { label: "Z", x: 464, y: 160 },
    ];
    expect(splitReceivers(skill).map((r) => `${r.side} #${r.number} ${r.label}`)).toEqual([
      "left #1 X",
      "left #2 F",
      "right #1 Z",
      "right #2 Y",
    ]);
  });

  it("counts 3x1 Trips as three to the strength", () => {
    const skill = [
      { label: "X", x: 36, y: 150 },
      { label: "H", x: 336, y: 160 },
      { label: "Y", x: 400, y: 160 },
      { label: "Z", x: 464, y: 150 },
    ];
    const right = splitReceivers(skill).filter((r) => r.side === "right");
    expect(right.map((r) => `#${r.number} ${r.label}`)).toEqual(["#1 Z", "#2 Y", "#3 H"]);
  });

  it("doesn't count a tight end or a wing on the box as split", () => {
    // Pro: Y is attached. Double Eagle: both TEs and both wings are on the box.
    expect(splitReceivers([{ label: "X", x: 40, y: 150 }, { label: "Y", x: 316, y: 150 }, { label: "Z", x: 444, y: 160 }]).map((r) => r.label)).toEqual(["X", "Z"]);
    expect(
      splitReceivers([
        { label: "X", x: 184, y: 150 },
        { label: "Y", x: 316, y: 150 },
        { label: "H", x: 162, y: 166 },
        { label: "Z", x: 338, y: 166 },
      ]),
    ).toEqual([]);
  });
});

describe("coverageStyleFor", () => {
  it.each<[string, CoverageStyle]>([
    ["", "ZONE_APEX"],
    ["Cover 3", "ZONE_APEX"],
    ["C3 SKY", "ZONE_APEX"],
    ["Cover 1", "MAN_OVER"],
    ["C0", "MAN_OVER"],
    ["1 ROBBER", "MAN_OVER"],
    ["MAN", "MAN_OVER"],
    ["Cover 2", "DEEP_SHELL"],
    ["2 MAN", "DEEP_SHELL"],
    ["Quarters", "DEEP_SHELL"],
    ["C4", "DEEP_SHELL"],
    ["Tampa", "DEEP_SHELL"],
  ])("%s → %s", (tag, style) => {
    expect(coverageStyleFor(tag)).toBe(style);
  });
});

describe("Scout D alignment rules", () => {
  it("2x2 Spread, Cover 3: SS apexes the strong #2, the Will walks out on the weak #2, FS in the middle", () => {
    const c = card("Spread Rt", "Cover 3");
    const d = buildDiagram(c, "team", "defense");
    const s = spots(d);
    const [x, f, y, z] = ["X", "F", "Y", "Z"].map((l) => receiverX(c, l));
    // Corners on the #1s.
    expect([s.C1.x, s.C2.x].sort((a, b) => a - b)).toEqual([x, z]);
    // SS halfway between Y and the right tackle, 7 yards off.
    expect(s.SS1.x).toBeCloseTo((y + 294) / 2, 0);
    expect(depth(s.SS1.y)).toBe(7);
    // Will halfway between F and the left tackle, 6 yards off.
    expect(s.W1.x).toBeCloseTo((f + 206) / 2, 0);
    expect(depth(s.W1.y)).toBe(6);
    // Mike and Sam stay in the box; FS over the ball, deep.
    expect(s.M1.x).toBe(250);
    expect(Math.abs(s.S1.x - 250)).toBeLessThan(60);
    expect(s.FS1.x).toBe(250);
    expect(depth(s.FS1.y)).toBeGreaterThanOrEqual(12);
    expect(d.defenseNotes).toEqual(["SS apex Y", "W apex F", "FS middle"]);
  });

  it("3x1 Trips, Cover 3: SS apexes #2, Sam apexes #3, one deep", () => {
    const c = card("Trips Rt", "Cover 3");
    const s = spots(buildDiagram(c, "team", "defense"));
    const [h, y] = ["H", "Y"].map((l) => receiverX(c, l));
    expect(s.SS1.x).toBeCloseTo((y + h) / 2, 0);
    expect(s.S1.x).toBeCloseTo((h + 294) / 2, 0);
    expect(depth(s.S1.y)).toBe(6);
    // Weak side: only the X, so the Will and Mike stay home.
    expect(s.W1.x).toBeLessThan(250);
    expect(Math.abs(s.W1.x - 250)).toBeLessThan(60);
    expect(s.FS1.x).toBe(250);
  });

  it("mirrors for Trips Left, and plays man over with an inside shade in Cover 1", () => {
    const c = card("Trips Lt", "Cover 1");
    const s = spots(buildDiagram(c, "team", "defense"));
    const [h, y] = ["H", "Y"].map((l) => receiverX(c, l));
    expect(y).toBeLessThan(250);
    // Head up on Y a yard inside (toward the ball), 6 off.
    expect(s.SS1.x).toBeCloseTo(y + YARD_X, 0);
    expect(depth(s.SS1.y)).toBe(6);
    expect(s.S1.x).toBeCloseTo(h + YARD_X, 0);
  });

  it("keeps two high in a Cover 2 shell: backers apex both #2s", () => {
    const c = card("Spread Rt", "Cover 2");
    const d = buildDiagram(c, "team", "defense");
    const s = spots(d);
    expect(depth(s.FS1.y)).toBeGreaterThanOrEqual(12);
    expect(depth(s.SS1.y)).toBeGreaterThanOrEqual(12);
    expect(s.FS1.x).not.toBe(s.SS1.x);
    expect(d.defenseNotes).toEqual(["S apex Y", "W apex F"]);
  });

  it("leaves a backer in the box: a 5-2 walks one out against Trips, never both", () => {
    const d = buildDiagram(card("Trips Rt", "Cover 3", "5-2"), "team", "defense");
    const s = spots(d);
    const backersInBox = [s.W1, s.M1].filter((p) => Math.abs(p.x - 250) < 40);
    expect(backersInBox).toHaveLength(1);
    // ...and he bumps over the ball.
    expect(backersInBox[0].x).toBe(250);
    expect(d.defenseNotes).toContain("M apex H");
  });

  it("changes nothing against Pro, I-Form or Double Eagle (one split receiver a side at most)", () => {
    for (const f of ["Pro Rt", "I Rt", "Double Eagle"]) {
      expect(buildDiagram(card(f, "Cover 3"), "team", "defense").defenseNotes).toEqual([]);
    }
  });

  it("works in 7v7 too (no line, backers only)", () => {
    const s = spots(buildDiagram(card("Trips Rt", "Cover 3"), "7v7", "defense"));
    expect(s.S1.x).toBeGreaterThan(294);
  });

  it("with the staff's secondary table, the DBs stay put and backers match what's left", () => {
    const table = { ...defaultAlignment(), ss: { depth: 8, anchor: "3" as const, shade: "inside" as const, side: "strong" as const } };
    const c = { ...card("Trips Rt", "Cover 3"), secondary: table };
    const d = buildDiagram(c, "team", "defense");
    const s = spots(d);
    const h = receiverX(c, "H");
    // SS is where the table says: over #3 (H), a yard and a half inside, 8 deep.
    expect(s.SS1.x).toBeCloseTo(h - 1.5 * YARD_X, 0);
    expect(depth(s.SS1.y)).toBe(8);
    // Y (#2) is still alone, so the Sam walks out on him.
    expect(d.defenseNotes).toEqual(["S apex Y"]);
  });

  it("a per-play safety depth moves FS and SS up or back without moving them across", () => {
    const c = card("Trips Rt", "Cover 3");
    const base = spots(buildDiagram(c, "team", "defense"));
    for (const yards of [4, 9, 13]) {
      const s = spots(buildDiagram({ ...c, defenseAlignment: { safetyDepthY: yards } }, "team", "defense"));
      expect(depth(s.FS1.y)).toBe(yards);
      expect(depth(s.SS1.y)).toBe(yards);
      expect(s.FS1.x).toBe(base.FS1.x);
      expect(s.SS1.x).toBe(base.SS1.x);
      expect(s.C1).toEqual(base.C1);
    }
  });

  it("a per-play coverage style overrides the tag, and a coach's drag still wins", () => {
    const c = card("Spread Rt", "Cover 3");
    const shell = buildDiagram({ ...c, defenseAlignment: { coverageStyle: "DEEP_SHELL" } }, "team", "defense");
    expect(shell.defenseNotes).not.toContain("FS middle");
    const dragged = spots(buildDiagram({ ...c, defenseOverrides: { SS1: { x: 300, y: 60 } } }, "team", "defense"));
    expect(dragged.SS1).toEqual({ x: 300, y: 60 });
  });

  it("reports a receiver nobody could be spared for", () => {
    const defenders: AlignDefender[] = [
      { label: "M", x: 250, y: 100, group: "lb" },
      { label: "C", x: 36, y: 100, group: "db" },
      { label: "C", x: 464, y: 100, group: "db" },
      { label: "FS", x: 250, y: 52, group: "db" },
    ];
    const r = alignDefense({
      skill: [
        { label: "X", x: 36, y: 150 },
        { label: "H", x: 336, y: 160 },
        { label: "Y", x: 400, y: 160 },
        { label: "Z", x: 464, y: 150 },
      ],
      defenders,
      strongDir: 1,
      style: "ZONE_APEX",
    });
    expect(r.uncovered).toEqual(["H"]);
    expect(r.notes).toContain("H uncovered");
  });

  it("safetyY clamps to what the card can show", () => {
    expect(safetyY(40)).toBe(140 - 18 * 7);
    expect(safetyY(0)).toBe(140 - 2 * 7);
  });
});

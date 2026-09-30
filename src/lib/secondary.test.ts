import { describe, expect, it } from "vitest";
import { buildDiagram, fromCardPoint } from "./formations";
import { parseHudlCsvText } from "./hudlParser";
import { alignmentFromFilm, defaultAlignment, describeAlignment, parseSecondaryText, placeDb } from "./secondary";

describe("parseSecondaryText", () => {
  it("reads a typed line onto the table", () => {
    const { alignment, unread } = parseSecondaryText("FS 12 middle, SS 8 over #3 inside, corners 7 outside");
    expect(unread).toEqual([]);
    expect(alignment.fs).toMatchObject({ depth: 12, anchor: "ball" });
    expect(alignment.ss).toMatchObject({ depth: 8, anchor: "3", shade: "inside", side: "strong" });
    expect(alignment.cs).toMatchObject({ depth: 7, shade: "outside" });
    expect(alignment.cw).toMatchObject({ depth: 7, shade: "outside" });
    expect(alignment.source).toBe("coach");
  });

  it("handles one corner, a weak safety, and reports what it can't read", () => {
    const { alignment, unread } = parseSecondaryText("boundary corner 5 inside; FS 14 weak hash; blitz the mike");
    expect(alignment.cw).toMatchObject({ depth: 5, shade: "inside" });
    expect(alignment.cs).toEqual(defaultAlignment().cs);
    expect(alignment.fs).toMatchObject({ depth: 14, anchor: "hash", side: "weak" });
    expect(unread).toEqual(["blitz the mike"]);
    expect(describeAlignment(alignment)).toContain("FS 14 yds, on the hash weak");
  });

  it("caps depth at what the card can show", () => {
    expect(parseSecondaryText("FS 40").alignment.fs?.depth).toBe(19);
  });
});

describe("placeDb", () => {
  // Trips right: #1 at 464, #2 at 400, #3 at 336; weak side X at 36.
  const receivers = { strong: [464, 400, 336], weak: [36] };

  it("puts a DB at his depth off the line, over his receiver with his shade", () => {
    const ss = placeDb("ss", { depth: 8, anchor: "3", shade: "inside", side: "strong" }, receivers, 1);
    expect(ss.y).toBe(140 - 8 * 7);
    expect(ss.x).toBeLessThan(336);
    const fs = placeDb("fs", { depth: 12, anchor: "ball", shade: "head-up" }, receivers, 1);
    expect(fs).toEqual({ x: 250, y: 140 - 12 * 7 });
    // No #2 on the weak side: the innermost receiver there.
    const cw = placeDb("cw", { depth: 6, anchor: "2", shade: "head-up" }, receivers, 1);
    expect(cw.x).toBe(36);
    // Mirrored for trips left.
    const mirrored = placeDb("ss", { depth: 8, anchor: "3", shade: "inside", side: "strong" }, {
      strong: [36, 100, 164],
      weak: [464],
    }, -1);
    expect(mirrored.x).toBeGreaterThan(164);
  });
});

describe("Scout D cards", () => {
  const [card] = parseHudlCsvText("OFF FORM,OFF PLAY,DEF FRONT\nTRIPS RT,SLANT,4-3\n").cards;

  it("draw the secondary from the table, and a drag still wins", () => {
    const secondary = parseSecondaryText("FS 15 middle, SS 6 #3, corners 8").alignment;
    const d = buildDiagram({ ...card, secondary }, "team", "defense");
    const at = (label: string) => fromCardPoint(d, d.defense.find((p) => p.label === label)!);
    expect(at("FS").y).toBe(140 - 15 * 7);
    expect(at("SS").y).toBe(140 - 6 * 7);
    expect(d.defense.filter((p) => p.label === "C").map((p) => fromCardPoint(d, p).y)).toEqual([84, 84]);
    const moved = buildDiagram({ ...card, secondary, defenseOverrides: { FS1: { x: 200, y: 30 } } }, "team", "defense");
    expect(fromCardPoint(moved, moved.defense.find((p) => p.id === "FS1")!)).toEqual({ x: 200, y: 30 });
  });
});

describe("alignmentFromFilm", () => {
  it("keeps well-formed DBs and drops the rest", () => {
    const a = alignmentFromFilm([
      { slot: "fs", depthYards: 13.2, anchor: "ball", shade: "head-up" },
      { slot: "ss", depthYards: 7, anchor: "3", shade: "outside", side: "strong" },
      { slot: "lb", depthYards: 4, anchor: "ball", shade: "head-up" },
      { slot: "cs", depthYards: "far", anchor: "1", shade: "inside" },
    ]);
    expect(a).toEqual({
      source: "film",
      fs: { depth: 13, anchor: "ball", shade: "head-up" },
      ss: { depth: 7, anchor: "3", shade: "outside", side: "strong" },
    });
    expect(alignmentFromFilm("nope")).toBeNull();
    expect(alignmentFromFilm([])).toBeNull();
  });
});

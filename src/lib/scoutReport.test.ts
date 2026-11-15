import { describe, expect, it } from "vitest";
import { parseHudlCsvText, type HudlPlayCard } from "./hudlParser";
import {
  applyReportFilter,
  defenseReport,
  describeFilter,
  familiesIn,
  familyLabel,
  familyOf,
  MIN_TOTAL,
  offenseReport,
  parseGain,
  readDefenseTag,
} from "./scoutReport";

const cardsOf = (rows: string[], header = "PLAY #,DN,DIST,HASH,OFF FORM,OFF PLAY,PLAY DIR,DEF FRONT,COVERAGE,RESULT") =>
  parseHudlCsvText([header, ...rows].join("\n")).cards;

// Their defense: Cover 3 most of the time, and every blitz comes on 3rd down.
const DEFENSE = cardsOf([
  "1,1,10,L,TRIPS,SLANT,R,4-3,COVER 3,Gain 5",
  "2,2,5,M,TRIPS,SLANT,R,4-3,COVER 3,Gain 4",
  "3,1,10,R,SPREAD,FADE,R,4-3,COVER 3,Gain 7",
  "4,2,3,L,SPREAD,FADE,R,4-3,COVER 3,Loss 2",
  "5,3,8,M,TRIPS,SLANT,R,4-3,6 - DOUBLE FIRE,Inc",
  "6,3,6,R,TRIPS,FADE,R,4-3,5 - LB,Gain 3",
  "7,3,9,L,SPREAD,SLANT,R,4-3,6 - DOUBLE FIRE,Gain 12",
  "8,3,4,M,SPREAD,FADE,R,4-3,5 - FIRE,Gain 2",
  "9,1,10,L,TRIPS,SLANT,R,4-3,COVER 3,Gain 6",
  "10,2,7,R,TRIPS,SLANT,R,4-3,COVER 1,Gain 1",
  "11,1,10,M,SPREAD,FADE,R,4-3,COVER 1,Gain 9",
  "12,2,6,L,SPREAD,FADE,R,4-3,COVER 3,Gain 0",
]);
const idsOf = (cards: HudlPlayCard[], ...numbers: number[]) => cards.filter((c) => numbers.includes(c.playNumber)).map((c) => c.id);

describe("parseGain", () => {
  it("reads yards where the result says them plainly", () => {
    expect(parseGain("Gain 6")).toBe(6);
    expect(parseGain("gain of 12")).toBe(12);
    expect(parseGain("Loss 3")).toBe(-3);
    expect(parseGain("Loss of 7")).toBe(-7);
    expect(parseGain("-2")).toBe(-2);
    expect(parseGain("+4")).toBe(4);
    expect(parseGain("5")).toBe(5);
    expect(parseGain("Inc")).toBe(0);
    expect(parseGain("Incomplete")).toBe(0);
  });

  it("says nothing where it doesn't: penalties, scores, blanks", () => {
    for (const r of ["", "  ", "Penalty 5", "PEN -10", "TD", "Fumble, recovered", "35 yd pass for a touchdown"]) expect(parseGain(r)).toBeNull();
  });
});

describe("readDefenseTag", () => {
  it("tells a blitz call (this staff writes those in COVERAGE) from a coverage, an odd tag and nothing", () => {
    expect(readDefenseTag({ coverage: "6 - DOUBLE FIRE" })).toEqual({ kind: "blitz", label: "6 rush · DOUBLE FIRE" });
    expect(readDefenseTag({ coverage: "5 - LB" })).toEqual({ kind: "blitz", label: "5 rush · LB" });
    expect(readDefenseTag({ coverage: "Cover 3 Sky" })).toEqual({ kind: "cover", family: "3" });
    expect(readDefenseTag({ coverage: "Quarters" })).toEqual({ kind: "cover", family: "4" });
    expect(readDefenseTag({ coverage: "prevent" })).toEqual({ kind: "other", label: "PREVENT" });
    expect(readDefenseTag({ coverage: "  " })).toEqual({ kind: "untagged" });
  });
});

describe("defenseReport", () => {
  const r = defenseReport(DEFENSE);

  it("counts fronts, coverages and blitz against the right bases", () => {
    expect(r.total).toBe(12);
    expect(r.fronts).toHaveLength(1);
    expect(r.fronts[0]).toMatchObject({ label: "4-3", count: 12, pct: 100 });
    // Coverages are of the 8 plays that weren't a blitz.
    expect(r.coverages.map((b) => [b.label, b.count, b.pct])).toEqual([
      ["Cover 3", 6, 75],
      ["Cover 1", 2, 25],
    ]);
    expect(r.pressure).toMatchObject({ tagged: 12, blitz: 4, rate: 33 });
    expect(r.pressure.calls.map((b) => [b.label, b.count])).toEqual([
      ["6 rush · DOUBLE FIRE", 2],
      ["5 rush · FIRE", 1],
      ["5 rush · LB", 1],
    ]);
    expect(r.manZone).toMatchObject({ man: 2, zone: 6 });
  });

  it("keeps the plays behind every number so a coach can open them", () => {
    expect(r.pressure.blitzIds.sort()).toEqual(idsOf(DEFENSE, 5, 6, 7, 8).sort());
    expect(r.coverages[0].ids.sort()).toEqual(idsOf(DEFENSE, 1, 2, 3, 4, 9, 12).sort());
    expect(r.manZone.ids.man.sort()).toEqual(idsOf(DEFENSE, 10, 11).sort());
  });

  it("averages gain only where results read as yards, and only with enough plays", () => {
    // Cover 3: 5, 4, 7, -2, 6, 0 = 20 over 6.
    expect(r.coverages[0].gain).toEqual({ avg: 3.3, plays: 6 });
    // Cover 1 has two plays: too few to quote.
    expect(r.coverages[1].gain).toBeNull();
  });

  it("splits the blitz rate by down", () => {
    expect(r.pressure.byDown.map((d) => [d.down, d.tagged, d.blitz, d.rate])).toEqual([
      [1, 4, 0, 0],
      [2, 4, 0, 0],
      [3, 4, 4, 100],
    ]); // no 4th-down snaps, so no 4th-down row
  });

  it("writes where to attack, each sentence with its sample size", () => {
    const text = r.insights.map((i) => i.text);
    expect(text).toContain("Blitzed 4 of 12 tagged snaps (33%).");
    expect(text).toContain("Blitz more on 3rd down: 4 of 4 (100%) against 33% overall.");
    // The downs where they never blitz are one line, not one each.
    expect(text).toContain("Blitz less on 1st and 2nd down: 0 of 8 (0%) against 33% overall.");
    expect(text.filter((t) => t.startsWith("Blitz less"))).toHaveLength(1);
    expect(text).toContain("Cover 3 on 6 of 8 non-blitz snaps (75%).");
    expect(text).toContain("Plays zone on 6 of 8 snaps (75%).");
    expect(text).toContain("4-3 front on 12 of 12 snaps (100%).");
    for (const i of r.insights) expect(i.n).toBeGreaterThanOrEqual(4);
    // Each sentence opens onto the plays it is about.
    expect(r.insights.find((i) => i.text.startsWith("Blitz more on 3rd"))!.ids.sort()).toEqual(idsOf(DEFENSE, 5, 6, 7, 8).sort());
  });

  it("reads one situation: 3rd down", () => {
    const third = defenseReport(DEFENSE, { down: 3 });
    expect(third.total).toBe(4);
    expect(third.pressure).toMatchObject({ tagged: 4, blitz: 4, rate: 100 });
    // Too few snaps to say anything about coverage, and no "blitz more on 3rd" while 3rd is already picked.
    expect(third.insights.map((i) => i.text).join("|")).not.toMatch(/Blitz more/);
  });

  it("reads a formation family", () => {
    const trips = defenseReport(DEFENSE, { family: familyOf(DEFENSE[0]) });
    expect(trips.total).toBe(6);
  });

  it("never reads a blank COVERAGE column as 'never blitzes'", () => {
    const blank = cardsOf(Array.from({ length: 12 }, (_, i) => `${i + 1},1,10,M,TRIPS,SLANT,R,4-3,,Gain 3`));
    const b = defenseReport(blank);
    expect(b.untagged).toBe(12);
    expect(b.pressure).toMatchObject({ tagged: 0, blitz: 0 });
    expect(b.insights.map((i) => i.text).join("|")).not.toMatch(/blitz/i);
  });

  it("says nothing it can't back: too few snaps, no sentences", () => {
    const few = defenseReport(DEFENSE.slice(0, MIN_TOTAL - 1));
    expect(few.pressure.tagged).toBe(MIN_TOTAL - 1);
    expect(few.insights).toEqual([]);
  });

  it("can say a team didn't blitz, when enough snaps were tagged to say it", () => {
    const calm = defenseReport(cardsOf(Array.from({ length: 9 }, (_, i) => `${i + 1},1,10,M,TRIPS,SLANT,R,4-3,COVER 3,Gain 3`)));
    expect(calm.insights.map((i) => i.text)).toContain("No blitz in 9 tagged snaps.");
  });

  it("leaves out the plays of the other team on film that holds both", () => {
    const film = DEFENSE.map((c, i) => (i < 4 ? { ...c, scoutSide: "offense" as const } : c));
    expect(defenseReport(film).total).toBe(8);
  });
});

// Their offense: runs on 1st down, passes on 3rd, every 3rd-down snap from Trips.
const OFFENSE = cardsOf(
  [
    "1,1,10,L,SPREAD,POWER,R,,,",
    "2,1,10,M,SPREAD,POWER,R,,,",
    "3,1,10,R,SPREAD,G ISO,L,,,",
    "4,1,10,L,SPREAD,SLANT,R,,,",
    "5,2,6,L,SPREAD,POWER,R,,,",
    "6,2,8,M,SPREAD,SLANT,R,,,",
    "7,2,7,R,SPREAD,FADE,R,,,",
    "8,2,9,L,SPREAD,CORNER,R,,,",
    "9,3,8,M,TRIPS,SLANT,R,,,",
    "10,3,7,R,TRIPS,FADE,R,,,",
    "11,3,9,L,TRIPS,CORNER,R,,,",
    "12,3,10,M,TRIPS,SLANT,R,,,",
  ],
);

describe("offenseReport", () => {
  const r = offenseReport(OFFENSE);

  it("counts run and pass, by down and by distance", () => {
    expect(r).toMatchObject({ total: 12, run: 4, pass: 8, other: 0, runPct: 33 });
    expect(r.byDown.map((d) => [d.label, d.run, d.pass, d.runPct])).toEqual([
      ["1st down", 3, 1, 75],
      ["2nd down", 1, 3, 25],
      ["3rd down", 0, 4, 0],
    ]);
    expect(r.byDistance.map((d) => d.label)).toEqual(["Medium yardage", "Long yardage"]);
  });

  it("splits by formation family, with the plays behind each side", () => {
    const trips = r.formations.find((f) => f.label === familyLabel(familyOf(OFFENSE[8])))!;
    expect(trips).toMatchObject({ total: 4, run: 0, pass: 4, runPct: 0 });
    expect(trips.passIds.sort()).toEqual(idsOf(OFFENSE, 9, 10, 11, 12).sort());
  });

  it("writes the tendencies a coach would circle, with their counts", () => {
    const text = r.insights.map((i) => i.text);
    expect(text).toContain("Run 4 of 12 plays (33%), pass 8 (67%).");
    expect(text).toContain("1st down: run 3 of 4 (75%), against 33% overall.");
    expect(text).toContain("3rd down: pass 4 of 4 (100%), against 67% overall.");
    expect(text.some((t) => t.startsWith("From ") && t.includes("pass 4 of 4"))).toBe(true);
  });

  it("does not repeat a situation the coach already picked", () => {
    const third = offenseReport(OFFENSE, { down: 3 });
    expect(third.total).toBe(4);
    expect(third.insights.map((i) => i.text).join("|")).not.toMatch(/3rd down:/);
  });

  it("reads where their runs go once there are enough of them", () => {
    const runs = cardsOf(
      Array.from({ length: 9 }, (_, i) => `${i + 1},1,10,M,SPREAD,POWER,${i < 7 ? "R" : "L"},,,`),
    );
    const d = offenseReport(runs);
    expect(d.runDirection).toMatchObject({ right: 7, left: 2 });
    expect(d.insights.map((i) => i.text)).toContain("Runs go right 7 of 9 times (78%).");
    // Too few runs: no sentence.
    expect(offenseReport(runs.slice(0, 5)).insights.map((i) => i.text).join("|")).not.toMatch(/Runs go/);
  });

  it("names the kinds of play they call", () => {
    expect(r.calls[0].count).toBeGreaterThan(0);
    expect(r.calls.map((c) => c.label)).toContain("Slant");
  });
});

describe("filters", () => {
  it("applyReportFilter narrows by down, distance, family and hash together", () => {
    expect(applyReportFilter(DEFENSE, { down: 3 })).toHaveLength(4);
    expect(applyReportFilter(DEFENSE, { down: 3, distance: "Long" })).toHaveLength(2); // 8 and 9 to go
    expect(applyReportFilter(DEFENSE, { hash: "M" })).toHaveLength(4);
    expect(applyReportFilter(DEFENSE, {})).toHaveLength(12);
  });

  it("describes a situation in a coach's words", () => {
    expect(describeFilter({})).toBe("all plays");
    expect(describeFilter({ down: 3, distance: "Long" })).toBe("3rd down, long yardage");
    expect(describeFilter({ family: "trio", hash: "L" })).toBe("from Trio, left hash");
  });

  it("lists the formation families in a script, most common first", () => {
    const f = familiesIn(DEFENSE);
    expect(f.reduce((n, x) => n + x.count, 0)).toBe(12);
    expect(f[0].count).toBeGreaterThanOrEqual(f[f.length - 1].count);
  });
});

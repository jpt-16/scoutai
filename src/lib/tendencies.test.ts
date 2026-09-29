import { describe, expect, it } from "vitest";
import { parseHudlCsvText } from "./hudlParser";
import { computeTendencies, formationSharePct, preferredDirection, situationRunPct } from "./tendencies";

const CSV = [
  "PLAY #,DN,DIST,HASH,OFF FORM,OFF PLAY,PLAY DIR",
  // 5 SPREAD, 3 TRIPS -> SPREAD 63%, TRIPS 38% of 8 plays
  "1,1,10,L,SPREAD,SLANT,R",
  "2,1,10,M,SPREAD,FADE,R",
  "3,2,2,R,SPREAD,POWER,R", // run, 2nd & Short
  "4,2,3,L,SPREAD,G ISO,L", // run, 2nd & Short
  "5,3,8,M,SPREAD,SLANT,R", // pass, 3rd & Long
  "6,1,10,L,TRIPS,FADE,L",
  "7,2,9,R,TRIPS,CORNER,L", // pass, 2nd & Long
  "8,3,1,M,TRIPS,DIVE,R", // run, 3rd & Short (goal-to-go-ish short)
].join("\n");

describe("computeTendencies", () => {
  it("computes formation share sorted by count, descending", () => {
    const { cards } = parseHudlCsvText(CSV);
    const t = computeTendencies(cards);
    expect(t.totalPlays).toBe(8);
    expect(t.formationShare[0]).toMatchObject({ formation: "SPREAD", count: 5, pct: 63 });
    expect(t.formationShare[1]).toMatchObject({ formation: "TRIPS", count: 3, pct: 38 });
  });

  it("splits run vs pass within a down/distance situation", () => {
    const { cards } = parseHudlCsvText(CSV);
    const t = computeTendencies(cards);
    // Two 2nd & Short plays, both runs (POWER, G ISO).
    expect(t.situationSplits["2nd & Short"]).toMatchObject({ run: 2, pass: 0, total: 2, runPct: 100 });
  });

  it("counts hash distribution", () => {
    const { cards } = parseHudlCsvText(CSV);
    const t = computeTendencies(cards);
    expect(t.hashSplit).toMatchObject({ L: 3, M: 3, R: 2, total: 8 });
  });

  it("counts play direction", () => {
    const { cards } = parseHudlCsvText(CSV);
    const t = computeTendencies(cards);
    // R: plays 1,2,3,5,8 = 5; L: plays 4,6,7 = 3.
    expect(t.directionSplit).toMatchObject({ left: 3, right: 5, total: 8 });
  });
});

describe("formationSharePct", () => {
  it("looks up a card's own formation share", () => {
    const { cards } = parseHudlCsvText(CSV);
    const t = computeTendencies(cards);
    expect(formationSharePct(t, { formation: "SPREAD" })).toBe(63);
    expect(formationSharePct(t, { formation: "spread" })).toBe(63); // case-insensitive
  });

  it("returns null for an untagged formation", () => {
    const { cards } = parseHudlCsvText(CSV);
    const t = computeTendencies(cards);
    expect(formationSharePct(t, { formation: "" })).toBeNull();
    expect(formationSharePct(t, { formation: "I-FORM" })).toBeNull();
  });
});

describe("situationRunPct", () => {
  it("returns the run% for a situation with enough reps", () => {
    const { cards } = parseHudlCsvText(CSV);
    const t = computeTendencies(cards);
    expect(situationRunPct(t, { down: 2, distance: 2, isGoalToGo: false })).toBe(100);
  });

  it("returns null below the minimum-reps threshold", () => {
    const { cards } = parseHudlCsvText(CSV);
    const t = computeTendencies(cards);
    // 3rd & Long has exactly one play (#5) -- too few reps to report.
    expect(situationRunPct(t, { down: 3, distance: 8, isGoalToGo: false })).toBeNull();
  });

  it("returns null with no down recorded", () => {
    const { cards } = parseHudlCsvText(CSV);
    const t = computeTendencies(cards);
    expect(situationRunPct(t, { down: null, distance: 10, isGoalToGo: false })).toBeNull();
  });
});

describe("preferredDirection", () => {
  it("picks the side with more plays", () => {
    const { cards } = parseHudlCsvText(CSV);
    const t = computeTendencies(cards);
    expect(preferredDirection(t)).toMatchObject({ side: "right", pct: 63 });
  });

  it("returns null on an exact split", () => {
    const even = "PLAY #,OFF FORM,OFF PLAY,PLAY DIR\n1,SPREAD,SLANT,L\n2,SPREAD,SLANT,R\n";
    const t = computeTendencies(parseHudlCsvText(even).cards);
    expect(preferredDirection(t)).toBeNull();
  });
});

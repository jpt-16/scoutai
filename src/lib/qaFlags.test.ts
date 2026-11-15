import { describe, expect, it } from "vitest";
import { parseHudlCsvText, type HudlPlayCard } from "./hudlParser";
import { expectedNext, filmDoubts, needsLook, qaFlagMap, qaFlags, summarizeFlags } from "./qaFlags";

const HEADER = "PLAY #,DN,DIST,YARD LN,OFF FORM,OFF PLAY,DEF FRONT,COVERAGE,RESULT";
const cardsOf = (rows: string[]) => parseHudlCsvText([HEADER, ...rows].join("\n")).cards;
const one = (row: string): HudlPlayCard => cardsOf([row])[0];

describe("filmDoubts", () => {
  it("picks out the sentences the film reader wrote about its own doubt", () => {
    const notes = "Film coverage: COVER 3. Check routes: H (curl or hitch). Lost early on film, check: Y (1.6 s). Tapped, but the film has no path for: Z. Coach says watch the safety.";
    expect(filmDoubts(notes)).toEqual([
      "Check routes: H (curl or hitch).",
      "Lost early on film, check: Y (1.6 s).",
      "Tapped, but the film has no path for: Z.",
    ]);
    expect(filmDoubts("Z cracks the S. Film coverage: COVER 1.")).toEqual([]);
    expect(filmDoubts("")).toEqual([]);
  });
});

describe("qaFlags", () => {
  it("is quiet on a clean play", () => {
    expect(qaFlags(one("1,1,10,-25,TRIPS,SLANT,4-3,COVER 3,Gain 5"))).toEqual([]);
  });

  it("flags the film's own doubts, until a coach has checked the play", () => {
    const doubtful = { ...one("1,1,10,-25,TRIPS,SLANT,4-3,COVER 3,Gain 5"), notes: "Check formation: film read Trips from 9 of 11 offensive players." };
    expect(qaFlags(doubtful)).toEqual([
      { code: "film-doubt", level: "check", message: "Check formation: film read Trips from 9 of 11 offensive players." },
    ]);
    expect(qaFlags({ ...doubtful, reviewedAt: "2026-11-14T10:00:00Z" })).toEqual([]);
  });

  it("flags a down, distance or yard line that can't be right, and keeps flagging after a review", () => {
    const base = one("1,1,10,-25,TRIPS,SLANT,4-3,COVER 3,Gain 5");
    const flags = qaFlags({ ...base, down: 5, distance: 140, yardLine: 63, yardLineLabel: "+63", reviewedAt: "2026-11-14T10:00:00Z" });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ code: "situation", level: "check" });
    expect(flags[0].message).toContain("down 5");
    expect(flags[0].message).toContain("140 to go");
    expect(flags[0].message).toContain("yard line +63");
  });

  it("leaves goal-to-go and a missing situation alone (film has none)", () => {
    const base = one("1,1,10,-25,TRIPS,SLANT,4-3,COVER 3,Gain 5");
    expect(qaFlags({ ...base, down: null, distance: null, yardLine: null })).toEqual([]);
    expect(qaFlags({ ...base, down: 1, distance: null, isGoalToGo: true })).toEqual([]);
  });

  it("flags a formation or front the app can't place, naming it", () => {
    const f = qaFlags(one("1,1,10,-25,REX,SLANT,STUNT FRONT,COVER 3,Gain 5"));
    expect(f.map((x) => x.code).sort()).toEqual(["formation", "front"]);
    expect(f.find((x) => x.code === "formation")!.message).toContain('"REX"');
    expect(f.find((x) => x.code === "front")!.message).toContain('"STUNT FRONT"');
  });

  it("notes a call that reads as neither run nor pass, without counting it", () => {
    const f = qaFlags(one("1,4,1,-25,TRIPS,KNEEL,4-3,COVER 3,Gain 0"));
    expect(f).toEqual([expect.objectContaining({ code: "call", level: "info" })]);
  });
});

describe("expectedNext", () => {
  const prev = (down: number, distance: number, result: string) => ({ ...one(`1,${down},${distance},-25,TRIPS,SLANT,4-3,COVER 3,${result}`) });

  it("1st down when the gain reaches the sticks, the next down and yards left when it doesn't", () => {
    expect(expectedNext(prev(2, 6, "Gain 8"))).toEqual({ down: 1, distance: null });
    expect(expectedNext(prev(2, 6, "Gain 6"))).toEqual({ down: 1, distance: null });
    expect(expectedNext(prev(1, 10, "Gain 4"))).toEqual({ down: 2, distance: 6 });
    expect(expectedNext(prev(2, 6, "Loss 3"))).toEqual({ down: 3, distance: 9 });
    expect(expectedNext(prev(2, 6, "Inc"))).toEqual({ down: 3, distance: 6 });
  });

  it("says nothing it can't follow: a penalty, a stop on 4th, no result", () => {
    expect(expectedNext(prev(2, 6, "Penalty 5"))).toBeNull();
    expect(expectedNext(prev(4, 3, "Gain 1"))).toBeNull();
    expect(expectedNext(prev(2, 6, ""))).toBeNull();
    expect(expectedNext({ ...prev(1, 10, "Gain 4"), isGoalToGo: true })).toBeNull();
  });
});

describe("qaFlagMap", () => {
  const seq = (rows: string[]) => {
    const cards = cardsOf(rows);
    return { cards, flags: qaFlagMap(cards) };
  };

  it("lets a script that follows itself through unflagged", () => {
    const { flags } = seq([
      "1,1,10,-25,TRIPS,SLANT,4-3,COVER 3,Gain 4",
      "2,2,6,-29,TRIPS,SLANT,4-3,COVER 3,Gain 7",
      "3,1,10,-36,TRIPS,SLANT,4-3,COVER 3,Inc",
      "4,2,10,-36,TRIPS,SLANT,4-3,COVER 3,Loss 2",
      "5,3,12,-34,TRIPS,SLANT,4-3,COVER 3,Gain 3",
    ]);
    expect(flags.size).toBe(0);
  });

  it("notes down and distance that don't follow the last play, as information only", () => {
    const { cards, flags } = seq([
      "1,1,10,-25,TRIPS,SLANT,4-3,COVER 3,Gain 4",
      "2,3,6,-29,TRIPS,SLANT,4-3,COVER 3,Gain 2", // should be 2nd & 6
    ]);
    const second = flags.get(cards[1].id)!;
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ code: "sequence", level: "info" });
    expect(second[0].message).toContain("After play 1 (1st & 10, Gain 4)");
    expect(second[0].message).toContain("2nd & 6");
    expect(second[0].message).toContain("3rd & 6");
    // …and it never counts toward "needs a look".
    expect(needsLook(flags)).toEqual([]);
  });

  it("doesn't compare across a gap in play numbers (a punt, a skipped row) or across films", () => {
    const { flags } = seq([
      "1,1,10,-25,TRIPS,SLANT,4-3,COVER 3,Gain 4",
      "3,3,6,-29,TRIPS,SLANT,4-3,COVER 3,Gain 2",
    ]);
    expect(flags.size).toBe(0);
    const a = cardsOf(["1,1,10,-25,TRIPS,SLANT,4-3,COVER 3,Gain 4"]).map((c) => ({ ...c, source: "a.csv" }));
    const b = cardsOf(["2,3,6,-29,TRIPS,SLANT,4-3,COVER 3,Gain 2"]).map((c) => ({ ...c, source: "b.csv" }));
    expect(qaFlagMap([...a, ...b]).size).toBe(0);
  });

  it("collects the plays with something to check, and counts them by kind", () => {
    const { cards, flags } = seq([
      "1,1,10,-25,TRIPS,SLANT,4-3,COVER 3,Gain 4",
      "2,2,6,-29,REX,SLANT,4-3,COVER 3,Gain 7",
      "3,1,10,-36,TRIPS,SLANT,STUNT FRONT,COVER 3,Inc",
    ]);
    expect(needsLook(flags).sort()).toEqual([cards[1].id, cards[2].id].sort());
    expect(summarizeFlags(cards, flags)).toEqual({ plays: 3, needsLook: 2, byCode: { formation: 1, front: 1 } });
  });
});

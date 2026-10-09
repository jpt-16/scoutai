import { describe, expect, it } from "vitest";
import { parseHudlCsvText, updateCard, type HudlPlayCard } from "./hudlParser";
import { changedFields, correctedCsv, nextUnchecked, reviewStatus, summarize, taggedCsv } from "./review";

const cards = (): HudlPlayCard[] =>
  parseHudlCsvText(
    [
      "PLAY #,OFF FORM,OFF STR,OFF PLAY,PLAY DIR,HASH,DEF FRONT,COVERAGE",
      "1,TRIO RT,R,Quick Slant,R,L,4-3,Cover 3",
      "2,Pro Rt,R,Iso,R,M,4-3,Cover 1",
      "3,Deuces,L,Mesh,L,R,3-4,Cover 2",
    ].join("\n"),
  ).cards;

const check = (c: HudlPlayCard): HudlPlayCard => ({ ...c, reviewedAt: "2026-10-11T12:00:00Z" });

describe("what Assist said is kept, and a fix is told by meaning", () => {
  it("snapshots the tags as they came in", () => {
    const [c] = cards();
    expect(c.tagged).toMatchObject({ formation: "TRIO RT", offStrength: "R", playCall: "Quick Slant", hash: "L", defFront: "4-3" });
  });

  it("the snapshot survives edits", () => {
    const [c] = cards();
    const edited = updateCard(c, { formation: "Trips Rt", playCall: "Smash" });
    expect(edited.tagged?.formation).toBe("TRIO RT");
    expect(edited.tagged?.playCall).toBe("Quick Slant");
  });

  it("respelling the same thing is not a fix", () => {
    const [c] = cards();
    expect(changedFields(updateCard(c, { formation: "Trips Rt" }))).toEqual([]); // TRIO = Trips
    expect(changedFields(updateCard(c, { defFront: "4-3 OVER" }))).toEqual([]);
  });

  it("a different formation, side, call or look is", () => {
    const [c] = cards();
    expect(changedFields(updateCard(c, { formation: "Pro Rt" }))).toEqual(["formation"]);
    expect(changedFields(updateCard(c, { offStrength: "L" }))).toEqual(["strength"]);
    expect(changedFields(updateCard(c, { playCall: "Smash" }))).toEqual(["playCall"]);
    expect(changedFields(updateCard(c, { playDir: "L" }))).toEqual(["direction"]);
    expect(changedFields(updateCard(c, { hash: "R" }))).toEqual(["hash"]);
    expect(changedFields(updateCard(c, { defFront: "3-4", coverage: "Cover 2" }))).toEqual(["front", "coverage"]);
  });

  it("status: unchecked, checked and right, checked and fixed", () => {
    const [c] = cards();
    expect(reviewStatus(c)).toBe("unchecked");
    expect(reviewStatus(check(c))).toBe("right");
    expect(reviewStatus(check(updateCard(c, { formation: "Pro Rt" })))).toBe("fixed");
  });
});

describe("the scorecard", () => {
  it("counts only what was checked, and where the tags were wrong", () => {
    const [a, b, c] = cards();
    const list = [check(a), check(updateCard(b, { formation: "Trips Rt", playCall: "Mesh" })), c];
    const s = summarize(list);
    expect(s).toMatchObject({ total: 3, checked: 2, right: 1, fixed: 1 });
    expect(s.wrong.formation).toBe(1);
    expect(s.wrong.playCall).toBe(1);
    expect(s.wrong.hash).toBe(0);
    expect(s.formationFixes).toEqual([{ from: "Pro", to: "Trips", count: 1 }]);
  });
});

describe("the two sheets", () => {
  it("lists the checked plays as tagged and as corrected, in a Hudl-style layout", () => {
    const [a, b, c] = cards();
    const list = [check(a), check(updateCard(b, { formation: "Trips Rt" })), c];
    const tagged = taggedCsv(list).split("\r\n");
    const corrected = correctedCsv(list).split("\r\n");
    expect(tagged[0]).toBe("PLAY #,FILM,OFF FORM,OFF STR,OFF PLAY,PLAY DIR,HASH,DEF FRONT,COVERAGE");
    expect(tagged).toHaveLength(3); // header + the two checked plays
    expect(tagged[2]).toContain("Pro Rt");
    expect(corrected[2]).toContain("Trips Rt");
    // They load back through the app's own parser.
    expect(parseHudlCsvText(corrected.join("\n")).cards).toHaveLength(2);
  });

  it("finds the next unchecked play, wrapping around", () => {
    const [a, b, c] = cards();
    expect(nextUnchecked([check(a), b, c], 0)).toBe(1);
    expect(nextUnchecked([a, check(b), check(c)], 2)).toBe(0);
    expect(nextUnchecked([check(a), check(b), check(c)], 0)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { inPeriod } from "./formations";
import { parseHudlCsvText } from "./hudlParser";
import { opponentLooks } from "./practicePlan";

const cards = parseHudlCsvText(
  "PLAY #,OFF FORM,OFF PLAY,PLAY TYPE,DEF FRONT,COVERAGE\n1,DUCES,MESH,Pass,4-3,COVER 3\n2,TRIO,SLANT,Pass,3-4,COVER 1\n3,PRO,POWER,Run,4-3,COVER 3\n",
).cards;

describe("film of the team being scouted (the red team)", () => {
  it("lists a play it ran as Scout O only, and a play it defended as Scout D only", () => {
    const [ran, defended, unsided] = [{ ...cards[0], scoutSide: "offense" as const }, { ...cards[1], scoutSide: "defense" as const }, cards[2]];
    expect(inPeriod(ran, "all", "offense")).toBe(true);
    expect(inPeriod(ran, "all", "defense")).toBe(false); // that defense is the other team's
    expect(inPeriod(defended, "all", "defense")).toBe(true);
    expect(inPeriod(defended, "team", "offense")).toBe(false); // that offense is the other team's
    // A play the film didn't place (or a sheet row) behaves as before.
    expect(inPeriod(unsided, "all", "offense")).toBe(true);
    expect(inPeriod(unsided, "all", "defense")).toBe(true);
  });

  it("builds the practice looks only from the plays the scouted team was on defense", () => {
    const filmed = [
      { ...cards[0], scoutSide: "offense" as const, defFront: "4-3", coverage: "COVER 3" }, // the other team's defense
      { ...cards[1], scoutSide: "defense" as const, defFront: "3-4", coverage: "COVER 1" },
    ];
    expect(opponentLooks(filmed).map((l) => l.key)).toEqual(["3-4|COVER 1"]);
    // Film of a team that never played defense in these clips has no looks (rather than the other team's).
    expect(opponentLooks([filmed[0]])).toEqual([]);
    // Cards with no side (a sheet) are as before.
    expect(opponentLooks(cards).length).toBeGreaterThan(0);
  });
});

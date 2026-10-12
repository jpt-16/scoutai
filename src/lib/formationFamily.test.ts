import { describe, expect, it } from "vitest";
import { classifyFormation } from "./hudlParser";
import { FAMILY_LABELS, familyKey, familyShape, formationFamily, isSpecificFamily, sameShape } from "./formationFamily";
import { parsePlaysheet } from "./practicePlan";

/** The practice script a staff handed over: personnel, formation, play. */
const SCRIPT = `Offensive Practice Scripts
Play\tPersonnel\tFormation\tPlay
1\tBoston\tPro rt\tDuo rt
2\tBoston\tTwins Rt\tBubble Rt
3\tBoston\tPro Lt\tToss Lt
4\tBoston\tPro Rt\tIso Rt
5\tBoston\tPro Rt\tVeer Rt
6\tBoston\tPro Lt\tCrossbuck Lt
7\tBoston\tTwins Rt\tNow Rit
8\tBoston\tTwins Rt\tDuo Lt
9\tBoston\tPro Rt\tMiami 292
10\tBoston\tPro Rt\tCrossbuck Rt
11\tBoston\tPro Rt\tToss Rt
12\tJacksonville\tAces Right\tZ motion Jet Right
13\tJacksonville\tAces Left\tZ motion Jet Left
14\tMiami\tDuces Gun\tTiger 22
15\tMiami\tDuces Gun\tLion Bubble Rt
16\tMiami\tDuces Gun\tTiger 21
17\tMiami\tTrio RI\tQuick Rt`;

describe("formationFamily", () => {
  it("names the staff's own formations, which the drawn shapes lump together", () => {
    // the app draws Twins as Pro and Aces and Duces both as Spread...
    expect(classifyFormation("Twins Rt")).toBe(classifyFormation("Pro Rt"));
    expect(classifyFormation("Aces Right")).toBe(classifyFormation("Duces Gun"));
    // ...but they are four formations to a defense
    const families = ["Pro rt", "Twins Rt", "Aces Right", "Duces Gun"].map((f) => formationFamily(f));
    expect(families).toEqual(["pro", "twins", "aces", "duces"]);
  });

  it("reads every formation in the sample practice script", () => {
    const reps = parsePlaysheet(SCRIPT);
    expect(reps).toHaveLength(17);
    const byFamily: Record<string, number> = {};
    for (const r of reps) {
      const f = formationFamily(r.formation);
      byFamily[f] = (byFamily[f] ?? 0) + 1;
    }
    expect(byFamily).toEqual({ pro: 8, twins: 3, aces: 2, duces: 3, trio: 1 });
  });

  it("ignores which side it is on, and capitalization, punctuation and typos in the side", () => {
    for (const t of ["Pro rt", "PRO LT", "pro right", "Pro, Rt", "PRO-RT"]) expect(formationFamily(t)).toBe("pro");
    for (const t of ["Aces Left", "ACES RIGHT", "aces gun", "Ace Right"]) expect(formationFamily(t)).toBe("aces");
    for (const t of ["Duces Gun", "deuces gun", "Deuce Rt"]) expect(formationFamily(t)).toBe("duces");
    for (const t of ["Trio RI", "Trio Rt", "trio gun left", "Trips Rt", "Trey Lt", "Slot Trips"]) expect(formationFamily(t)).toBe("trio");
  });

  it("takes the same names from the film analyzer's own words", () => {
    expect(formationFamily("deuces gun")).toBe("duces");
    expect(formationFamily("trio gun right")).toBe("trio");
    expect(formationFamily("aces off gun left")).toBe("aces");
    expect(formationFamily("empty gun")).toBe("empty");
    expect(formationFamily("bunch gun left")).toBe("bunch");
    expect(formationFamily("twins right")).toBe("twins");
    expect(formationFamily("pro left")).toBe("pro");
  });

  it("reads a more specific name over a more general one in the same text", () => {
    expect(formationFamily("Twins Pro Rt")).toBe("twins");
    expect(formationFamily("Aces Gun")).toBe("aces");
    expect(formationFamily("Empty Trips")).toBe("empty");
    expect(formationFamily("Split Pro")).toBe("split-pro");
    expect(formationFamily("Power I")).toBe("i-form");
    expect(formationFamily("Double Eagle")).toBe("double-eagle");
  });

  it("falls back to the shape a formation draws as when it names no family", () => {
    expect(formationFamily("", "pro")).toBe("pro");
    expect(formationFamily("REX", "trips")).toBe("trio");
    expect(formationFamily("REX", "spread")).toBe("spread");
    expect(formationFamily("Gun")).toBe("spread");
    expect(formationFamily("REX")).toBe("unknown");
  });

  it("knows which families say more than their shape, and which shape each is drawn as", () => {
    expect(isSpecificFamily("twins")).toBe(true);
    expect(isSpecificFamily("spread")).toBe(false);
    expect(isSpecificFamily("unknown")).toBe(false);
    expect(familyShape("twins")).toBe("pro");
    expect(familyShape("aces")).toBe("spread");
    expect(familyShape("bunch")).toBe("trips");
    expect(sameShape("twins", "pro")).toBe(true);
    expect(sameShape("aces", "pro")).toBe(false);
    expect(familyKey("twins")).toBe("fam:twins");
    expect(FAMILY_LABELS.duces).toBe("Duces");
  });
});

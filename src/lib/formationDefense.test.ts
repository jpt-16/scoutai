import { describe, expect, it } from "vitest";
import { readDefense, secondaryFromFilm } from "./defenseRead";
import { parseHudlCsvText } from "./hudlParser";
import { assignLooks, defenseVsScript, opponentLooks, periodRepCards, repFamily, familyOf, type PracticePeriod } from "./practicePlan";
import { dbAlignmentFor } from "./secondary";
import type { TrackedPlayFile } from "./trackedPlay";

const track = (team: "offense" | "defense", [x, y]: [number, number], id: number) => ({
  id,
  team,
  start: [x, y] as [number, number],
  points: [0, 0.5, 1].map((t) => [t, x, y] as [number, number, number]),
});
const still = (offense: [number, number][], defense: [number, number][]): TrackedPlayFile => ({
  tracks: [...offense.map((p, i) => track("offense", p, i)), ...defense.map((p, i) => track("defense", p, 100 + i))],
});
const SET: [number, number][] = [
  [-2.5, -0.8], [-1.2, -0.8], [0, -0.8], [1.2, -0.8], [2.5, -0.8],
  [0, -5], [1.5, -5.5],
  [-18, -0.5], [-9, -1.2], [9, -1.2], [18, -0.5],
];
const D_SHALLOW: [number, number][] = [
  [-3.2, 1], [-1, 1], [1, 1], [3.2, 1], [-2, 5], [2, 5], [8.5, 5], [-18, 7], [18.5, 7], [-9, 12], [9, 12.5],
];
const D_DEEP: [number, number][] = [
  [-3.2, 1], [-1, 1], [1, 1], [3.2, 1], [-2, 5], [2, 5], [8.5, 5], [-18, 7], [18.5, 7], [-8, 15], [9, 15.5],
];

const row = (n: number, form: string, call: string, front: string, coverage: string) =>
  `${n},${form},${call},Pass,${front},${coverage}`;
const film = (rows: string[]) =>
  parseHudlCsvText(`PLAY #,OFF FORM,OFF PLAY,PLAY TYPE,DEF FRONT,COVERAGE\n${rows.join("\n")}\n`).cards;

describe("fronts keyed on the formation the staff names", () => {
  // Against Twins they play a 3-4, against Pro a 4-3; both draw as Pro.
  const cards = film([
    ...[1, 2, 3, 4].map((n) => row(n, "TWINS RT", "SLANT", "3-4", "COVER 2")),
    ...[5, 6, 7, 8].map((n) => row(n, "PRO RT", "SLANT", "4-3", "COVER 3")),
  ]);
  const looks = opponentLooks(cards);
  const rep = (formation: string) => ({ formation, call: `${formation} 24 DIVE` });

  it("gives Twins and Pro their own looks though both draw as Pro", () => {
    const picks = assignLooks(
      [
        { formationKey: "pro", family: familyOf(rep("Twins Rt"), {}), look: null, kind: "pass" },
        { formationKey: "pro", family: familyOf(rep("Pro Rt"), {}), look: null, kind: "pass" },
      ],
      looks,
    );
    expect(picks[0]).toMatchObject({ front: "3-4", coverage: "COVER 2", basis: "formation" });
    expect(picks[1]).toMatchObject({ front: "4-3", coverage: "COVER 3", basis: "formation" });
  });

  it("falls back to the drawn shape when there is no film of the exact formation", () => {
    // Aces (a spread shape) with film only of Pro and Twins: no Spread film either, so their overall mix.
    const none = assignLooks([{ formationKey: "spread", family: "fam:aces", look: null, kind: "run" }], looks);
    expect(none[0]?.basis).toBe("overall");
    // Add Duces film (also a Spread shape): Aces now uses the shape's looks.
    const withDuces = opponentLooks([...cards, ...film([1, 2, 3, 4].map((n) => row(n + 20, "DUCES", "FADE", "4-2-5", "COVER 4")))]);
    const shaped = assignLooks([{ formationKey: "spread", family: "fam:aces", look: null, kind: "pass" }], withDuces);
    expect(shaped[0]).toMatchObject({ front: "4-2-5", basis: "shape" });
  });

  it("keeps a look written on the playsheet", () => {
    const [pick] = assignLooks([{ formationKey: "pro", family: "fam:twins", look: { front: "5-2", coverage: "C1" } }], looks);
    expect(pick).toMatchObject({ front: "5-2", fromFilm: false });
  });

  it("puts the rep cards of a script against the right front", () => {
    const period: PracticePeriod = {
      id: "p",
      name: "Team",
      kind: "team",
      side: "offense",
      text: "1. Twins Rt Slant\n2. Pro Rt Slant\n3. Twins Lt Slant",
    };
    const fronts = periodRepCards(period, cards, {}).map((c) => c.defFront);
    expect(fronts).toEqual(["3-4", "4-3", "3-4"]);
  });
});

describe("the secondary per formation family", () => {
  const shallow = readDefense(still(SET, D_SHALLOW))!;
  const deep = readDefense(still(SET, D_DEEP))!;
  const tables = secondaryFromFilm([
    { formationKey: "pro", formation: "twins right", read: deep },
    { formationKey: "pro", formation: "twins right", read: deep },
    { formationKey: "pro", formation: "pro left", read: shallow },
    { formationKey: "spread", formation: "deuces gun", read: shallow },
  ]);

  it("writes a table per family and one per shape", () => {
    expect(tables["fam:twins"]?.plays).toBe(2);
    expect(tables["fam:pro"]?.plays).toBe(1);
    expect(tables["fam:duces"]?.plays).toBe(1);
    expect(tables.pro?.plays).toBe(3);
    expect(tables["fam:twins"]?.fs?.depth).toBeGreaterThan(tables["fam:pro"]!.fs!.depth);
  });

  it("looks a card up by family first, then by shape, and the coach's table beats film", () => {
    expect(dbAlignmentFor(tables, "Twins Rt", "pro")).toBe(tables["fam:twins"]);
    expect(dbAlignmentFor(tables, "Pro Rt", "pro")).toBe(tables["fam:pro"]);
    // Aces: no family table, so the Spread shape's (from Duces).
    expect(dbAlignmentFor(tables, "Aces", "spread")).toBe(tables.spread);
    const coach = { ...tables, pro: { source: "coach" as const, cs: { depth: 5, anchor: "1" as const, shade: "outside" as const } } };
    expect(dbAlignmentFor(coach, "Twins Rt", "pro")).toBe(coach.pro);
  });

  it("is what the playsheet panel reports, and where it came from", () => {
    const looks = opponentLooks(
      film([
        ...[1, 2, 3, 4].map((n) => row(n, "TWINS RT", "SLANT", "3-4", "COVER 2")),
        ...[5, 6].map((n) => row(n, "DUCES", "FADE", "4-2-5", "COVER 4")),
      ]),
    );
    const rows = defenseVsScript(
      [{ side: "offense", text: "1. Twins Rt Slant\n2. Twins Lt Slant\n3. Aces Rt Fade\n4. Duces Lt Fade" }],
      looks,
      tables,
      {},
    );
    const by = Object.fromEntries(rows.map((r) => [r.family, r]));
    expect(by.twins).toMatchObject({ reps: 2, filmSnaps: 4, looksBasis: "formation", secondaryBasis: "formation" });
    expect(by.twins.looks[0].look.front).toBe("3-4");
    expect(by.aces).toMatchObject({ reps: 1, filmSnaps: 0, looksBasis: "shape", secondaryBasis: "shape" });
    expect(by.aces.looks[0].look.front).toBe("4-2-5");
    expect(by.duces.secondaryBasis).toBe("formation");
  });
});

describe("repFamily", () => {
  it("reads the staff's formation, else the shape it draws as", () => {
    expect(repFamily({ formation: "Aces Left", call: "Aces Left 24" }, {})).toBe("aces");
    expect(repFamily({ formation: "REX", call: "REX 24" }, { REX: "trips" })).toBe("trio");
  });
});


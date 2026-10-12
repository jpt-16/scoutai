import { describe, expect, it } from "vitest";
import { FIELD, YARD_PX, YARD_X } from "./formations";
import { parseHudlCsvText } from "./hudlParser";
import { applyDefenseRead, dbSpots, defenseMovesFor, defenseOverridesFor, frontsByFormation, readDefense, secondaryFromFilm } from "./defenseRead";
import { buildDiagram } from "./formations";
import type { TrackedPlayFile } from "./trackedPlay";

/** A still picture of a play at the snap: every man at his spot for a second. */
function still(offense: [number, number][], defense: [number, number][]): TrackedPlayFile {
  const track = (team: "offense" | "defense", [x, y]: [number, number], id: number) => ({
    id,
    team,
    start: [x, y] as [number, number],
    points: [0, 0.5, 1].map((t) => [t, x, y] as [number, number, number]),
  });
  return {
    tracks: [
      ...offense.map((p, i) => track("offense", p, i)),
      ...defense.map((p, i) => track("defense", p, 100 + i)),
    ],
  };
}

// Deuces (2x2) with one back: line, Q, back, two receivers each side.
const DEUCES: [number, number][] = [
  [-2.5, -0.8], [-1.2, -0.8], [0, -0.8], [1.2, -0.8], [2.5, -0.8],
  [0, -5], [1.5, -5.5],
  [-18, -0.5], [-9, -1.2], [9, -1.2], [18, -0.5],
];
// A 4-2-5: four down, two backers, a nickel over the right slot, corners over the #1s, two high safeties.
const FOUR_TWO_FIVE: [number, number][] = [
  [-3.2, 1], [-1, 1], [1, 1], [3.2, 1],
  [-2, 5], [2, 5],
  [8.5, 5],
  [-18, 7], [18.5, 7],
  [-9, 12], [9, 12.5],
];

describe("reading the defense at the snap", () => {
  it("names a 4-2-5 with two high safeties, and its front key", () => {
    const read = readDefense(still(DEUCES, FOUR_TWO_FIVE))!;
    expect(read.label).toBe("4-2-5");
    expect(read.frontKey).toBe("4-3");
    expect(read.shell).toBe("2-high");
    expect(read.defenders.filter((d) => d.role === "cb").map((d) => d.x).sort((a, b) => a - b)).toEqual([-18, 18.5]);
  });

  it("calls five down with the center and both guards covered a Bear, and a wider five a 5-2", () => {
    const bear = readDefense(still(DEUCES, [[-4.5, 1], [-1.3, 1], [0, 1], [1.3, 1], [4.5, 1], [-2, 5], [2, 5], [-18, 7], [18, 7], [0, 12], [6, 8]]))!;
    expect(bear.frontKey).toBe("bear");
    expect(bear.label).toBe("Bear");
    const fiveTwo = readDefense(still(DEUCES, [[-5.5, 1], [-3, 1], [0, 1], [3, 1], [5.5, 1], [-2, 5], [2, 5], [-18, 7], [18, 7], [0, 12], [6, 9]]))!;
    expect(fiveTwo.frontKey).toBe("5-2");
  });

  it("keeps eleven: people standing out past the widest receiver (the sideline) are dropped first", () => {
    const read = readDefense(still(DEUCES, [...FOUR_TWO_FIVE, [26, 3], [-25, 6]]))!;
    expect(read.defenders).toHaveLength(11);
    expect(read.defenders.some((d) => Math.abs(d.x) > 24)).toBe(false);
  });

  it("says nothing when too few defenders were found", () => {
    expect(readDefense(still(DEUCES, FOUR_TWO_FIVE.slice(0, 6)))).toBeNull();
  });
});

describe("putting it on the card", () => {
  const [row] = parseHudlCsvText("PLAY #,OFF FORM,OFF PLAY,PLAY TYPE\n5,DUCES,FADE SPEED OUT HITCH FADE,Pass\n").cards;
  const read = readDefense(still(DEUCES, FOUR_TWO_FIVE))!;

  it("takes the film's front when the sheet left it blank, and moves each defender to where he stood", () => {
    const card = applyDefenseRead(row, read);
    expect(card.defFront).toBe("4-2-5");
    expect(card.frontKey).toBe("4-3");
    expect(card.notes).toContain("Film D: 4-2-5, 2-high");
    const moved = Object.values(card.defenseOverrides ?? {});
    expect(moved.length).toBe(11);
    // The right corner, over the #1 at 18.5 yards, 7 off the ball.
    const x = Math.round(FIELD.center.x + 18.5 * YARD_X);
    const y = Math.round(FIELD.los - 7 * YARD_PX);
    expect(moved.some((p) => p.x === x && p.y === y)).toBe(true);
  });

  it("never puts a down lineman on a backer's or DB's id, or the other way round", () => {
    const over = defenseOverridesFor({ ...row, frontKey: "4-3" }, read);
    const lineIds = Object.keys(over).filter((id) => /^[ETN]\d/.test(id));
    for (const id of lineIds) expect(over[id].y).toBeGreaterThan(FIELD.los - 2.5 * YARD_PX);
  });

  it("keeps a front the sheet tagged", () => {
    const tagged = { ...row, defFront: "3-4 OKIE" };
    expect(applyDefenseRead(tagged, read).defFront).toBe("3-4 OKIE");
  });
});

describe("the secondary per formation", () => {
  const read = readDefense(still(DEUCES, FOUR_TWO_FIVE))!;

  it("reads corners over the #1s and the safeties' depth and side", () => {
    const spots = dbSpots(read);
    expect(spots.cs?.anchor).toBe("1");
    expect(spots.cw?.anchor).toBe("1");
    expect(spots.cs?.depth).toBe(7);
    expect(spots.fs?.depth).toBeGreaterThanOrEqual(12);
    expect(spots.ss?.depth).toBeGreaterThanOrEqual(12);
  });

  it("rolls the plays up by formation, and leaves a table the coach set alone", () => {
    const tables = secondaryFromFilm(
      [
        { formationKey: "spread", read },
        { formationKey: "spread", read },
        { formationKey: "trips", read },
      ],
      { trips: { source: "coach", cs: { depth: 5, anchor: "1", shade: "outside" } } },
    );
    expect(tables.spread?.source).toBe("film");
    expect(tables.spread?.cs?.depth).toBe(7);
    expect(tables.trips?.source).toBe("coach");
    expect(frontsByFormation([{ formation: "Deuces", read }, { formation: "Deuces", read }])[0]).toBe("Duces: 4-2-5 (2 of 2), 2-high");
  });
});

describe("a read that can't be a real defense", () => {
  it("isn't written on the card or the formation table, only noted", () => {
    const [row] = parseHudlCsvText("PLAY #,OFF FORM,OFF PLAY,PLAY TYPE\n5,DUCES,FADE SPEED OUT HITCH FADE,Pass\n").cards;
    // One man down (the line hidden behind the offense's), the rest scattered deep and wide.
    const read = readDefense(still(DEUCES, [[0, 1], [-2, 5], [-18, 7], [18, 7], [-12, 9], [12, 9], [-8, 12], [8, 12], [0, 14], [-15, 10], [15, 10]]))!;
    expect(read.plausible).toBe(false);
    const card = applyDefenseRead(row, read);
    expect(card.defFront).toBe("");
    expect(card.notes).toContain("Check D");
    expect(secondaryFromFilm([{ formationKey: "spread", read }]).spread).toBeUndefined();
  });
});

describe("where each defender went after the snap (the arrows on the card)", () => {
  /** The 4-2-5 standing, then (1.5 s on) the nickel flows out to the flat and a safety rotates down; everyone else holds. */
  function moving(): TrackedPlayFile {
    const base = still(DEUCES, FOUR_TWO_FIVE);
    const goes: Record<number, [number, number]> = { 106: [14, 3], 109: [4, 5.5] }; // the nickel, a safety: where they are at 1.5 s
    return {
      tracks: base.tracks.map((t) => {
        const to = goes[t.id];
        if (!to) return { ...t, points: [[0, ...t.start], [1, ...t.start], [2, ...t.start]] as [number, number, number][] };
        const [x0, y0] = t.start;
        return { ...t, points: [[0, x0, y0], [1.5, to[0], to[1]], [2, to[0], to[1]]] as [number, number, number][] };
      }),
    };
  }

  it("reads who moved (not who stood his ground), capped at a reasonable length", () => {
    const read = readDefense(moving())!;
    const moved = read.defenders.filter((d) => d.move);
    expect(moved).toHaveLength(2);
    const nickel = moved.find((d) => d.role === "nb")!;
    expect(nickel.move!.dx).toBeCloseTo(14 - 8.5, 0);
    expect(read.defenders.filter((d) => !d.move)).toHaveLength(read.defenders.length - 2);
  });

  it("puts an arrow on the card from each defender who moved, and none on a card with no film", () => {
    const [row] = parseHudlCsvText("PLAY #,OFF FORM,OFF PLAY,PLAY TYPE\n5,DUCES,FADE SPEED OUT HITCH FADE,Pass\n").cards;
    const read = readDefense(moving())!;
    const card = applyDefenseRead(row, read);
    expect(Object.keys(card.defenseMoves ?? {})).toHaveLength(2);
    expect(buildDiagram(card, "team", "defense").defenseArrows).toHaveLength(2);
    expect(buildDiagram(row, "team", "defense").defenseArrows).toEqual([]);
    // Each arrow starts on a defender of the card and ends away from him.
    const d = buildDiagram(card, "team", "defense");
    for (const arrow of d.defenseArrows) {
      expect(d.defense.some((p) => Math.hypot(p.x - arrow[0].x, p.y - arrow[0].y) < 0.5)).toBe(true);
      expect(Math.hypot(arrow[1].x - arrow[0].x, arrow[1].y - arrow[0].y)).toBeGreaterThan(8);
    }
    expect(defenseMovesFor(row, read)).toEqual(card.defenseMoves);
    void defenseOverridesFor;
  });
});

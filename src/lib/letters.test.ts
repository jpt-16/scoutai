import { describe, expect, it } from "vitest";
import { buildDiagram } from "./formations";
import { parseHudlCsvText } from "./hudlParser";

const cardFor = (formation: string, str: "L" | "R") =>
  parseHudlCsvText(`PLAY #,OFF FORM,OFF STR,OFF PLAY,PLAY DIR\n1,${formation},${str},QUICK SLANT,R\n`).cards[0];

describe("the staff's letters: left to right X, F, Y, Z, with H the back", () => {
  for (const formation of ["Deuces", "Trio", "Trips", "Spread", "Bunch"]) {
    for (const str of ["L", "R"] as const) {
      it(`${formation} strength ${str}`, () => {
        const d = buildDiagram(cardFor(formation, str));
        const receivers = d.players.filter((p) => p.role === "WR").sort((a, b) => a.x - b.x);
        expect(receivers.map((p) => p.label)).toEqual(["X", "F", "Y", "Z"]);
        const back = d.players.filter((p) => p.role === "RB");
        expect(back.map((p) => p.label)).toEqual(["H"]);
      });
    }
  }

  it("trio right is X alone on the left, F Y Z across the trips; trio left mirrors who is where, not the letters", () => {
    const right = buildDiagram(cardFor("Trio", "R")).players.filter((p) => p.role === "WR");
    const xRight = right.find((p) => p.label === "X")!;
    expect(xRight.x).toBeLessThan(250);
    expect(right.filter((p) => p.x > 250).map((p) => p.label).sort()).toEqual(["F", "Y", "Z"]);
    const left = buildDiagram(cardFor("Trio", "L")).players.filter((p) => p.role === "WR");
    expect(left.filter((p) => p.x < 250).map((p) => p.label).sort()).toEqual(["F", "X", "Y"]);
    expect(left.find((p) => p.label === "Z")!.x).toBeGreaterThan(250);
  });
});

import { describe, expect, it } from "vitest";
import { buildDiagram, FORMATION_LABELS } from "./formations";
import { parseHudlCsvText } from "./hudlParser";

describe("Wing T (the old Double Eagle): a tight end each side, wings outside them, the back behind the QB", () => {
  const wingT = (hash: string) => buildDiagram({ ...parseHudlCsvText(`PLAY #,HASH,OFF FORM,OFF PLAY,PLAY TYPE\n1,${hash},WING T,DIVE,Run\n`).cards[0] }, "team", "offense");
  it("is read from either name and labelled Wing T", () => {
    expect(parseHudlCsvText("PLAY #,OFF FORM\n1,Wing-T\n2,Wing T Rt\n3,Double Eagle\n").cards.map((c) => c.formationKey)).toEqual(["double-eagle", "double-eagle", "double-eagle"]);
    expect(FORMATION_LABELS["double-eagle"]).toBe("Wing T");
  });
  it("is even on both sides if cut in half, on a hash too", () => {
    for (const hash of ["M", "L", "R"]) {
      const d = wingT(hash);
      const at = (l: string) => d.players.find((p) => p.label === l)!;
      const q = d.players.find((p) => p.role === "QB")!;
      // Tight ends and wings mirror each other about the quarterback, and the back is right behind him.
      expect(at("X").x - q.x).toBeCloseTo(-(at("Y").x - q.x), 5);
      expect(at("H").x - q.x).toBeCloseTo(-(at("Z").x - q.x), 5);
      expect(at("F").x).toBeCloseTo(q.x, 5);
    }
  });
});

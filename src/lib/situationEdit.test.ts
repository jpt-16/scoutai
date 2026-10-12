import { describe, expect, it } from "vitest";
import { MOCK_HUDL_CSV } from "./demoScript";
import { parseDistance, parseHudlCsvText, parseYardLine, updateCard } from "./hudlParser";
import { buildDiagram } from "./formations";

/**
 * Film can't say what down it was or how far there was to go (a press-box recording has no scoreboard), so a card made
 * from film alone starts with those blank and the coach fills them in. They have to redraw the card like a sheet's would.
 */

const filmCard = () => {
  const [card] = parseHudlCsvText("PLAY #,OFF FORM,OFF PLAY\n7,TRIPS RT,SLANT").cards;
  return card;
};

describe("a play with no down and distance", () => {
  it("shows a dash until the coach says", () => {
    const card = filmCard();
    expect(card.downDistance).toBe("—");
    expect(card.down).toBeNull();
    expect(card.yardLine).toBeNull();
  });

  it("takes a down and a distance and writes them the way a sheet's would read", () => {
    const edited = updateCard(filmCard(), { down: 3, distance: 6, isGoalToGo: false });
    expect(edited).toMatchObject({ down: 3, distance: 6, downDistance: "3rd & 6", edited: true });
  });

  it("takes goal to go, and a down with no distance yet", () => {
    expect(updateCard(filmCard(), { down: 1, distance: null, isGoalToGo: true }).downDistance).toBe("1st & G");
    expect(updateCard(filmCard(), { down: 2, distance: null, isGoalToGo: false }).downDistance).toBe("2nd & ?");
  });

  it("takes the yard line and draws the field to it", () => {
    const base = filmCard();
    const at = (yardLine: number | null, label: string) => buildDiagram(updateCard(base, { yardLine, yardLineLabel: label }), "team", "offense");
    const own35 = updateCard(base, { yardLine: parseYardLine("OWN 35"), yardLineLabel: "OWN 35" });
    expect(own35).toMatchObject({ yardLine: -35, yardLineLabel: "OWN 35" });
    expect(updateCard(base, { yardLine: parseYardLine("OPP 40"), yardLineLabel: "OPP 40" }).yardLine).toBe(40);
    // the card's yard numbers move with it (the field is drawn true to the ball's spot)
    expect(JSON.stringify(at(-35, "OWN 35"))).not.toBe(JSON.stringify(at(40, "OPP 40")));
  });

  it("clears a down and a yard line the coach takes back out", () => {
    const set = updateCard(filmCard(), { down: 4, distance: 2, isGoalToGo: false, yardLine: -20, yardLineLabel: "-20" });
    const cleared = updateCard(set, { down: null, distance: null, isGoalToGo: false, yardLine: null, yardLineLabel: "" });
    expect(cleared).toMatchObject({ down: null, downDistance: "—", yardLine: null, yardLineLabel: "" });
  });

  it("reads what a coach types in the boxes the same way the sheet reader does", () => {
    expect(parseDistance("6")).toEqual({ distance: 6, isGoalToGo: false });
    expect(parseDistance("G")).toEqual({ distance: null, isGoalToGo: true });
    expect(parseDistance("")).toEqual({ distance: null, isGoalToGo: false });
    expect(parseYardLine("OWN 3")).toBe(-3);
    expect(parseYardLine("OWN 3x")).toBeNull(); // not a yard line yet; the box keeps what was typed
    expect(parseYardLine("55")).toBeNull();
  });

  it("leaves a sheet's own down and distance alone when only something else is edited", () => {
    const [card] = parseHudlCsvText(MOCK_HUDL_CSV).cards;
    const edited = updateCard(card, { notes: "watch the X" });
    expect(edited.down).toBe(card.down);
    expect(edited.downDistance).toBe(card.downDistance);
  });
});

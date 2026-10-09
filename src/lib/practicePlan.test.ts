import { describe, expect, it } from "vitest";
import { buildDiagram } from "./formations";
import { parseHudlCsvText } from "./hudlParser";
import {
  assignLooks,
  opponentLooks,
  parsePlaysheet,
  parsePlaysheetLine,
  playbookCallLine,
  periodRepCards,
  periodScoutOCards,
  setLineLook,
  splitLook,
  type PracticePeriod,
} from "./practicePlan";

const period = (text: string): PracticePeriod => ({
  id: "p1",
  name: "Period 5",
  kind: "team",
  side: "offense",
  text,
});

describe("parsePlaysheetLine", () => {
  it("reads a typed call as-is", () => {
    expect(parsePlaysheetLine("TRIPS RT 836")).toMatchObject({
      call: "TRIPS RT 836",
      hash: null,
      look: null,
    });
  });

  it("drops a leading rep number but keeps run numbers in the call", () => {
    expect(parsePlaysheetLine("1. DEUCES LT IZ")?.call).toBe("DEUCES LT IZ");
    expect(parsePlaysheetLine("12) TRIPS RT 836")?.call).toBe("TRIPS RT 836");
    expect(parsePlaysheetLine("24 DIVE")?.call).toBe("24 DIVE");
  });

  it("reads Excel / Sheets rows: rep #, hash cell, formation, play", () => {
    const rep = parsePlaysheetLine("3\tL\tTRIPS RT\t836");
    expect(rep).toMatchObject({
      call: "TRIPS RT 836",
      formation: "TRIPS RT",
      hash: "L",
    });
  });

  it("reads hash tokens and a 'vs' look in typed lines", () => {
    expect(parsePlaysheetLine("RH DEUCES RT 92 vs 3-4 C1")).toMatchObject({
      call: "DEUCES RT 92",
      hash: "R",
      look: { front: "3-4", coverage: "C1" },
    });
    expect(parsePlaysheetLine("PRO LT POWER (M)")).toMatchObject({
      call: "PRO LT POWER",
      hash: "M",
    });
    expect(parsePlaysheetLine("I RT ISO left hash")).toMatchObject({
      call: "I RT ISO",
      hash: "L",
    });
  });

  it("skips blank and divider lines", () => {
    expect(parsePlaysheet("TRIPS RT 836\n\n-----\nPRO LT POWER")).toHaveLength(2);
  });
});

describe("splitLook", () => {
  it("separates front from coverage", () => {
    expect(splitLook("4-3 OVER COV 3")).toEqual({
      front: "4-3 OVER",
      coverage: "COV 3",
    });
    expect(splitLook("Bear")).toEqual({ front: "Bear", coverage: "" });
    expect(splitLook("3-4 Tampa 2")).toEqual({
      front: "3-4",
      coverage: "Tampa 2",
    });
  });
});

const FILM = [
  "PLAY #,ODK,OFF FORM,OFF PLAY,DEF FRONT,COVERAGE",
  "1,D,TRIPS RT,SLANT,3-4,C1",
  "2,D,TRIPS LT,FADE,3-4,C1",
  "3,D,TRIPS RT,IZ,4-3,C3",
  "4,D,SPREAD,IZ,4-3,C3",
  "5,D,SPREAD,SLANT,4-3,C3",
  "6,D,SPREAD,FADE,4-3,C3",
  "7,O,SPREAD,IZ,5-2,C0",
].join("\n");

describe("opponentLooks", () => {
  it("counts only the opponent's defensive snaps when ODK is tagged", () => {
    const looks = opponentLooks(parseHudlCsvText(FILM).cards);
    expect(looks.map((l) => [l.key, l.count])).toEqual([
      ["4-3|C3", 4],
      ["3-4|C1", 2],
    ]);
    expect(looks[1].vs.trips).toBe(2);
  });
});

describe("assignLooks", () => {
  const looks = opponentLooks(parseHudlCsvText(FILM).cards);

  it("matches the look they played against that formation, in proportion", () => {
    const picks = assignLooks(
      Array.from({ length: 3 }, () => ({
        formationKey: "trips" as const,
        look: null,
      })),
      looks,
    );
    // vs Trips: 3-4 C1 twice, 4-3 C3 once.
    expect(picks.map((p) => p?.front)).toEqual(["3-4", "4-3", "3-4"]);
  });

  it("keeps a look written on the playsheet", () => {
    const [pick] = assignLooks([{ formationKey: "trips", look: { front: "Bear", coverage: "C0" } }], looks);
    expect(pick).toEqual({ front: "Bear", coverage: "C0", fromFilm: false });
  });

  it("returns no look without film", () => {
    expect(assignLooks([{ formationKey: "spread", look: null }], [])).toEqual([null]);
  });
});

describe("periodRepCards", () => {
  const film = parseHudlCsvText(FILM).cards;

  it("turns each line into a Scout D card in playsheet order", () => {
    const cards = periodRepCards(period("L\tTRIPS RT\t836\nDEUCES LT IZ vs Bear C0"), film, {});
    expect(cards.map((c) => [c.playNumber, c.formation, c.hash, c.formationKey])).toEqual([
      [1, "TRIPS RT 836", "L", "trips"],
      [2, "DEUCES LT IZ", null, "spread"],
    ]);
    expect(cards[1]).toMatchObject({
      defFront: "Bear",
      coverage: "C0",
      frontKey: "bear",
    });
    expect(cards[0].id).toMatch(/^rep-/);
    const diagram = buildDiagram(cards[0], "team", "defense");
    expect(diagram.formationFallback).toBe(false);
  });

  it("draws the staff's own formation names from the alias list", () => {
    const [card] = periodRepCards(period("REX RT 836"), film, { REX: "trips" });
    expect(card.formationKey).toBe("trips");
    expect(buildDiagram(card, "team", "defense").formationFallback).toBe(false);
    const [unknown] = periodRepCards(period("REX RT 836"), film, {});
    expect(unknown.formationKey).toBe("unknown");
  });
});

describe("setLineLook", () => {
  it("writes and clears a line's look without touching the others", () => {
    const text = "TRIPS RT 836\nPRO LT POWER vs 4-3";
    const set = setLineLook(text, 0, { front: "3-4", coverage: "C1" });
    expect(set).toBe("TRIPS RT 836 vs 3-4 C1\nPRO LT POWER vs 4-3");
    expect(setLineLook(set, 1, null)).toBe("TRIPS RT 836 vs 3-4 C1\nPRO LT POWER");
  });
});

describe("periodScoutOCards", () => {
  it("runs the opponent's offensive snaps only, for that period type", () => {
    const film = parseHudlCsvText(FILM).cards;
    expect(periodScoutOCards({ kind: "team" }, film).map((c) => c.playNumber)).toEqual([7]);
    const untagged = parseHudlCsvText("PLAY #,OFF FORM,OFF PLAY\n1,SPREAD,IZ\n2,TRIPS,SLANT").cards;
    expect(periodScoutOCards({ kind: "7v7" }, untagged).map((c) => c.playNumber)).toEqual([2]);
  });
});

describe("playbookCallLine", () => {
  const line = (csv: string) => playbookCallLine(parseHudlCsvText(csv).cards[0]);

  it("writes a playbook play the way a playsheet reads", () => {
    expect(line("OFF FORM,OFF PLAY\nTrips Rt,836\n")).toBe("TRIPS RT 836");
  });

  it("adds the strength side when the formation name doesn't carry one", () => {
    expect(line("OFF FORM,OFF STR,OFF PLAY\nDeuces,L,IZ\n")).toBe("DEUCES LT IZ");
  });

  it("round-trips: the line draws a Scout D card in the same formation", () => {
    const text = line("OFF FORM,OFF STR,OFF PLAY\nTrips,L,Mesh\n");
    const [rep] = periodRepCards(period(text), [], {});
    expect(rep.formationKey).toBe("trips");
    expect(rep.formationSide).toBe("left");
  });
});

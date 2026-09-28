import { describe, expect, it } from "vitest";
import { MOCK_HUDL_CSV } from "./demoScript";
import { buildDiagram } from "./formations";
import {
  classifyConcept,
  classifyFormation,
  classifyFront,
  cleanCsvText,
  mapColumns,
  parseHash,
  parseHudlCsvText,
  parseYardLine,
  repairCsvLine,
} from "./hudlParser";

describe("mapColumns", () => {
  it("maps the standard Hudl headers", () => {
    const columns = mapColumns(["PLAY #", "DN", "DIST", "HASH", "YARD LN", "OFF FORM", "OFF PLAY", "DEF FRONT"]);
    expect(columns).toMatchObject({
      playNumber: "PLAY #",
      down: "DN",
      distance: "DIST",
      hash: "HASH",
      yardLine: "YARD LN",
      formation: "OFF FORM",
      playCall: "OFF PLAY",
      defFront: "DEF FRONT",
    });
  });

  it("accepts the alternate spellings, ignoring case and spacing", () => {
    const columns = mapColumns(["play", " Down ", "distance", "ball on", "formation", "play_call", "def  align"]);
    expect(columns).toMatchObject({
      playNumber: "PLAY",
      down: "DOWN",
      distance: "DISTANCE",
      yardLine: "BALL ON",
      formation: "FORMATION",
      playCall: "PLAY CALL",
      defFront: "DEF ALIGN",
    });
  });

  it("prefers OFF PLAY over PLAY TYPE and keeps PLAY TYPE as run/pass", () => {
    const columns = mapColumns(["OFF PLAY", "PLAY TYPE"]);
    expect(columns.playCall).toBe("OFF PLAY");
    expect(columns.playType).toBe("PLAY TYPE");
  });

  it("falls back to PLAY TYPE as the play call when it is the only option", () => {
    const columns = mapColumns(["PLAY TYPE", "OFF FORMATION", "FRONT"]);
    expect(columns.playCall).toBe("PLAY TYPE");
    expect(columns.playType).toBeUndefined();
    expect(columns.formation).toBe("OFF FORMATION");
    expect(columns.defFront).toBe("FRONT");
  });
});

describe("parseHudlCsvText", () => {
  it("parses the demo script into five cards", () => {
    const result = parseHudlCsvText(MOCK_HUDL_CSV);
    expect(result.cards).toHaveLength(5);
    expect(result.missingColumns).toEqual([]);
    expect(result.warnings).toEqual([]);

    expect(result.cards.map((c) => [c.formationKey, c.concept, c.frontKey])).toEqual([
      ["spread", "inside-zone", "4-3"],
      ["trips", "slant", "3-4"],
      ["i-form", "power", "5-2"],
      ["double-eagle", "sweep", "4-3"],
      ["pro", "boot", "unknown"], // "Cover 3" is a coverage, not a front
    ]);

    expect(result.cards[1]).toMatchObject({
      playNumber: 2,
      down: 2,
      distance: 4,
      downDistance: "2nd & 4",
      hash: "L",
      yardLine: 39,
      yardLineLabel: "Opp 39",
      formation: "Trips Right",
      formationSide: "right",
      playDirection: "right",
    });
    expect(result.cards[4].raw.RESULT).toBe("Touchdown");
  });

  it("mirrors left-handed formations and reads Bear", () => {
    const csv = "PLAY #,DN,DIST,HASH,YARD LN,OFF FORM,OFF PLAY,DEF FRONT\n5,3,2,R,+12,DOUBLE EAGLE LT,SWEEP LT,BEAR\n";
    expect(parseHudlCsvText(csv).cards[0]).toMatchObject({
      yardLine: 12,
      formationKey: "double-eagle",
      formationSide: "left",
      playDirection: "left",
      concept: "sweep",
      frontKey: "bear",
    });
  });

  it("strips a BOM, uses the row index when PLAY # is missing, and handles goal-to-go", () => {
    const csv = "﻿DOWN,DISTANCE,HASH,FORMATION,PLAY CALL,FRONT\n1,G,Left,Trips Lt,Verts,50\n";
    const [card] = parseHudlCsvText(csv).cards;
    expect(card.playNumber).toBe(1);
    expect(card.downDistance).toBe("1st & G");
    expect(card.hash).toBe("L");
    expect(card.formationKey).toBe("trips");
    expect(card.formationSide).toBe("left");
    expect(card.concept).toBe("verticals");
    expect(card.frontKey).toBe("5-2");
  });

  it("skips special teams and blank rows and reports it", () => {
    const csv = "PLAY #,ODK,DN,DIST,OFF FORM,OFF PLAY,DEF FRONT\n1,K,,,,,\n2,O,1,10,I,ISO,4-3\n3,O,,,,,\n";
    const result = parseHudlCsvText(csv);
    expect(result.cards.map((c) => c.playNumber)).toEqual([2]);
    expect(result.rowCount).toBe(3);
    expect(result.warnings.some((w) => w.includes("Skipped 2 rows"))).toBe(true);
    expect(result.missingColumns).toContain("hash");
  });

  describe("messy exports", () => {
    const header = "PLAY #,ODK,DN,DIST,YARD LN,HASH,OFF FORM,OFF PLAY,DEF FRONT,RESULT";
    const row = "1,O,3,6,Opp 45,L,Trips Right,Quick Slant,4-3,Gain 6";
    const expectOneCard = (csv: string) => {
      const result = parseHudlCsvText(csv);
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({
        playNumber: 1,
        downDistance: "3rd & 6",
        yardLine: 45,
        hash: "L",
        formation: "Trips Right",
        formationKey: "trips",
        playCall: "Quick Slant",
        concept: "slant",
        frontKey: "4-3",
      });
      expect(result.warnings.filter((w) => /Too many fields/.test(w))).toEqual([]);
      return result;
    };

    it("skips a title line above the header (was: Too many fields: expected 1)", () => {
      const result = expectOneCard(`Week 7 Breakdown - Central\n${header}\n${row}\n`);
      expect(result.warnings).toContain("Skipped 1 line above the header row (title or notes).");
    });

    it("skips an Excel sep= line", () => {
      expectOneCard(`sep=,\n${header}\n${row}\n`);
    });

    it("auto-detects semicolon, tab, and pipe delimiters", () => {
      for (const d of [";", "\t", "|"]) {
        expectOneCard(`${header.replaceAll(",", d)}\n${row.replaceAll(",", d)}\n`);
      }
    });

    it("trims spaces around commas in headers and values", () => {
      expectOneCard(`${header.replaceAll(",", " , ")}\r\n${row.replaceAll(",", " ,  ")}\r\n\r\n`);
    });

    it("keeps raw values as text even though numbers are typed", () => {
      const result = expectOneCard(`${header}\n${row}\n`);
      expect(result.cards[0].raw.DN).toBe("3");
      expect(result.cards[0].raw["YARD LN"]).toBe("Opp 45");
    });
  });

  describe("quotes and invisible characters", () => {
    const header = "PLAY #,DN,DIST,OFF FORM,OFF PLAY,DEF FRONT";
    const second = "2,1,10,Spread,IZ,4-3";
    const plays = (csv: string) => parseHudlCsvText(csv).cards.map((c) => [c.playCall, c.defFront]);

    it("cleanCsvText straightens curly quotes and normalizes odd spaces", () => {
      expect(cleanCsvText("\u201CHot\u201D \u2018Rt\u2019\u00A0x\u200By")).toBe(`"Hot" 'Rt' x y`);
    });

    it("keeps a curly-quoted play name without swallowing the rest of the file", () => {
      // Straightened, this becomes "Hot" Slant Rt: an unbalanced quoted cell.
      expect(plays(`${header}\n1,3,6,Trips Rt,\u201CHot\u201D Slant Rt,4-3\n${second}\n`)).toEqual([
        ['"Hot" Slant Rt', "4-3"],
        ["IZ", "4-3"],
      ]);
    });

    it("reads unescaped quotes inside a quoted cell (Trailing quote malformed)", () => {
      const result = parseHudlCsvText(`${header}\n1,3,6,Trips Rt,"Slant "Hot" Rt",4-3\n${second}\n`);
      expect(result.cards.map((c) => c.playCall)).toEqual(['Slant "Hot" Rt', "IZ"]);
      expect(result.warnings.some((w) => /malformed|quote/i.test(w))).toBe(true);
    });

    it("keeps commas inside a curly-quoted cell in one column", () => {
      expect(plays(`${header}\n1,3,6,Trips Rt,\u201CSlant, Hot\u201D,4-3\n${second}\n`)).toEqual([
        ["Slant, Hot", "4-3"],
        ["IZ", "4-3"],
      ]);
    });

    it("keeps reading valid rows around a broken one", () => {
      const csv = `${header}\n1,3,6,Trips Rt,"Hot" Slant Rt,4-3\n${second}\n3,2,5,Pro,Power,5-2\n`;
      expect(parseHudlCsvText(csv).cards.map((c) => c.playNumber)).toEqual([1, 2, 3]);
    });

    it.each([
      ['a,"Slant "Hot" Rt",b', 'a,"Slant ""Hot"" Rt",b'],
      ['a,"Hot" Slant,b', 'a,"""Hot"" Slant",b'],
      ['a,"x, y",b', 'a,"x, y",b'],
      ['a,"""Hot"" Rt",', 'a,"""Hot"" Rt",'],
      ["a;\"q\" r;b", 'a;"""q"" r";b'],
    ])("repairCsvLine %s", (line, fixed) => {
      expect(repairCsvLine(line, line.includes(";") ? ";" : ",")).toBe(fixed);
    });
  });

  it("warns when the file doesn't look like a Hudl breakdown", () => {
    const result = parseHudlCsvText("NAME,EMAIL\nA,b@c.d\n");
    expect(result.cards).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/Hudl breakdown/);
  });
});

describe("classifiers", () => {
  it.each([
    ["TRIPS RT", "trips"],
    ["Bunch Lt", "trips"],
    ["I-FORM", "i-form"],
    ["Power I Rt", "i-form"],
    ["DBL EAGLE", "double-eagle"],
    ["PRO LT", "pro"],
    ["Split Back", "pro"],
    ["2x2", "spread"],
    ["DOUBLES GUN", "spread"],
    ["WILDCAT", "unknown"],
  ])("formation %s → %s", (text, key) => {
    expect(classifyFormation(text)).toBe(key);
  });

  it.each([
    ["4-3 OVER", "4-3"],
    ["43", "4-3"],
    ["4-2-5", "4-3"],
    ["3-4", "3-4"],
    ["3-3-5 STACK", "3-4"],
    ["5-2", "5-2"],
    ["OKIE", "5-2"],
    ["BEAR", "bear"],
    ["46", "bear"],
    ["", "unknown"],
  ])("front %s → %s", (text, key) => {
    expect(classifyFront(text)).toBe(key);
  });

  it.each([
    ["IZ RT", "inside-zone"],
    ["OUTSIDE ZONE", "outside-zone"],
    ["COUNTER GT", "power"],
    ["JET SWEEP", "sweep"],
    ["4 VERTS", "verticals"],
    ["BUBBLE SCREEN", "screen"],
    ["BOOT LT", "boot"],
    ["SMASH", "dropback"],
    ["QB SNEAK", "qb-run"],
  ])("play %s → %s", (text, concept) => {
    expect(classifyConcept(text)).toBe(concept);
  });

  it("uses PLAY TYPE when the play call is unrecognized", () => {
    expect(classifyConcept("BLUE 42", "Run")).toBe("inside-zone");
    expect(classifyConcept("BLUE 42", "Pass")).toBe("dropback");
  });

  it.each([
    ["L", "L"],
    ["Right", "R"],
    ["MID", "M"],
    ["x", null],
  ])("hash %s → %s", (text, hash) => {
    expect(parseHash(text)).toBe(hash);
  });

  it.each([
    ["Opp 45", 45],
    ["OPP8", 8],
    ["+20", 20],
    ["Own 35", -35],
    ["-35", -35],
    ["50", 50],
    ["Mid", 50],
    ["", null],
    ["Opp 60", null],
  ])("yard line %s → %s", (text, yardLine) => {
    expect(parseYardLine(text)).toBe(yardLine);
  });
});

describe("buildDiagram", () => {
  it("places 11 on offense and 11 on defense for every demo play", () => {
    for (const card of parseHudlCsvText(MOCK_HUDL_CSV).cards) {
      const diagram = buildDiagram(card);
      expect(diagram.offense.length + 1).toBe(11);
      expect(diagram.defense).toHaveLength(11);
      expect(diagram.routes.length).toBeGreaterThan(0);
    }
  });

  it("never stacks two defenders on the same spot", () => {
    const formations = ["spread", "trips", "i-form", "double-eagle", "pro"] as const;
    const fronts = ["4-3", "3-4", "5-2", "bear"] as const;
    for (const formationKey of formations) {
      for (const frontKey of fronts) {
        for (const side of ["left", "right"] as const) {
          const { defense } = buildDiagram({
            formationKey,
            frontKey,
            formationSide: side,
            playDirection: side,
            concept: "unknown",
            hash: null,
          });
          for (let i = 0; i < defense.length; i++) {
            for (let j = i + 1; j < defense.length; j++) {
              const gap = Math.hypot(defense[i].x - defense[j].x, defense[i].y - defense[j].y);
              expect(gap, `${formationKey} ${side} vs ${frontKey}`).toBeGreaterThan(18);
            }
          }
        }
      }
    }
  });

  it("mirrors a left-handed formation", () => {
    const base = { frontKey: "4-3", concept: "unknown", hash: null } as const;
    const right = buildDiagram({ ...base, formationKey: "trips", formationSide: "right", playDirection: "right" });
    const left = buildDiagram({ ...base, formationKey: "trips", formationSide: "left", playDirection: "left" });
    const xs = (pts: { x: number }[]) => pts.map((p) => p.x).sort((a, b) => a - b);
    expect(xs(left.offense)).toEqual(xs(right.offense.map((p) => ({ x: 500 - p.x }))));
  });
});

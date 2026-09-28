import { describe, expect, it } from "vitest";
import { MOCK_HUDL_CSV } from "./demoScript";
import { buildDiagram, isPassPlay, runScheme } from "./formations";
import {
  classifyConcept,
  type FormationKey,
  classifyFormation,
  classifyFront,
  detectUnsupportedFile,
  sanitizeCsvInput,
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

  it("skips special teams and fully blank rows, but keeps a row with just a play #", () => {
    const csv =
      "PLAY #,ODK,DN,DIST,OFF FORM,OFF PLAY,DEF FRONT\n1,K,,,,,\n2,O,1,10,I,ISO,4-3\n3,O,,,,,\n,O,,5,,,\n";
    const result = parseHudlCsvText(csv);
    expect(result.cards.map((c) => c.playNumber)).toEqual([2, 3]);
    expect(result.rowCount).toBe(4);
    expect(result.warnings).toContain("Skipped 1 special teams row (ODK = K).");
    expect(result.warnings).toContain("Skipped 1 row with no play #, down, formation, play call, or result.");
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

    it("sanitizeCsvInput straightens quotes, normalizes newlines, strips invisibles", () => {
      expect(sanitizeCsvInput("\uFEFF\u201CHot\u201D \u2018Rt\u2019\u00A0x\u200By\u0007\r\nz\rw\tv")).toBe(
        `"Hot" 'Rt' xy\nz\nw\tv`,
      );
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

  describe("row shape fallbacks", () => {
    const header = "PLAY #,DN,DIST,HASH,OFF FORM,OFF PLAY,DEF FRONT";

    it("reads rows with missing trailing commas and extra cells", () => {
      const csv = `${header}\n1,3,6,L,Trips Rt,Slant\n2,1,10,R,Spread,IZ,4-3,extra,cells\n`;
      const result = parseHudlCsvText(csv);
      expect(result.cards.map((c) => [c.playNumber, c.playCall, c.defFront])).toEqual([
        [1, "Slant", ""],
        [2, "IZ", "4-3"],
      ]);
      expect(result.warnings.filter((w) => /fields/i.test(w))).toEqual([]);
    });

    it("skips rows whose PLAY #, DN, OFF FORM, and OFF PLAY are all blank", () => {
      const csv = `${header}\n1,1,10,L,Spread,IZ,4-3\n,,5,M,,,Bear\n ,  , , , , ,\n3,2,4,R,Pro,Power,5-2\n`;
      const result = parseHudlCsvText(csv);
      expect(result.cards.map((c) => c.playNumber)).toEqual([1, 3]);
      // The all-whitespace row never reaches us: skipEmptyLines "greedy" drops it.
      expect(result.warnings).toContain(
        "Skipped 1 row with no play #, down, formation, play call, or result.",
      );
    });

    it("finds the header row by DOWN / FORMATION keywords below notes", () => {
      const csv = "Scouting report,,\nOpponent: Central,,\nDOWN,FORMATION,PLAY CALL\n2,Trips Lt,Verts\n";
      const result = parseHudlCsvText(csv);
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0]).toMatchObject({ down: 2, formationKey: "trips", concept: "verticals" });
      expect(result.warnings[0]).toBe("Skipped 2 lines above the header row (title or notes).");
    });

    it("never throws on junk input", () => {
      for (const junk of ["", "\n\n", '"', "a,b\n\u0000\u0001", ",,,\n,,,"]) {
        expect(() => parseHudlCsvText(junk)).not.toThrow();
        expect(parseHudlCsvText(junk).cards).toEqual([]);
      }
    });
  });

  describe("header row detection", () => {
    const header = "PLAY #,ODK,DN,DIST,YARD LN,HASH,OFF FORM,OFF PLAY,DEF FRONT";
    const rows = "1,O,3,6,Opp 45,L,Trips Right,Slant,4-3\n2,O,1,10,Own 30,R,Spread,IZ,3-4";

    it.each([
      ["title and blank lines", `Hudl Breakdown Export\nTeam: Central\n\n\n${header}\n${rows}`, 2],
      ["key,value metadata", `Opponent,Central High\nGame,Week 7\n${header}\n${rows}`, 2],
      ["a title containing commas", `Central vs. Eastside, Week 7, 2026\n${header}\n${rows}`, 1],
      ["22 note lines", `${Array.from({ length: 22 }, (_, i) => `note ${i}`).join("\n")}\n${header}\n${rows}`, 22],
      [
        "a metadata line that mentions formation and front",
        `Offensive formation report,Defensive front summary\nPrepared by,Coach\n${header}\n${rows}`,
        2,
      ],
    ])("finds the header below %s", (_, csv, skipped) => {
      const result = parseHudlCsvText(csv);
      expect(result.cards.map((c) => c.formationKey)).toEqual(["trips", "spread"]);
      expect(result.warnings[0]).toMatch(new RegExp(`^Skipped ${skipped} lines? above the header row`));
    });

    it("maps spelled-out column names", () => {
      const csv =
        "Title\nPlay Number,Down,Yards To Go,Ball On,Hash Mark,Offensive Formation,Offensive Play,Defensive Front\n" +
        "7,2,4,+30,R,Trips Lt,Verts,Bear\n";
      const result = parseHudlCsvText(csv);
      expect(result.missingColumns).toEqual([]);
      expect(result.cards[0]).toMatchObject({
        playNumber: 7,
        downDistance: "2nd & 4",
        formationKey: "trips",
        concept: "verticals",
        frontKey: "bear",
      });
    });

    it("does not read DEF FORMATION as the offensive formation", () => {
      const columns = mapColumns(["Play #", "Dn", "Off. Formation", "Off Play Name", "Def Formation"]);
      expect(columns).toMatchObject({
        formation: "OFF FORMATION",
        playCall: "OFF PLAY NAME",
        defFront: "DEF FORMATION",
      });
    });

    it("converts DN, DIST, YARD LN, and PLAY # to numbers", () => {
      const csv = `${header}\n" 07 ",3rd,6 yds, -35 ,L,Spread,IZ,4-3\n`.replace('" 07 ",', '" 07 ",O,');
      const [card] = parseHudlCsvText(csv).cards;
      expect(card).toMatchObject({ playNumber: 7, down: 3, distance: 6, yardLine: -35, yardLineLabel: "-35" });
    });
  });

  describe("relaxed validation", () => {
    it("keeps plays with a blank DEF FRONT or OFF PLAY", () => {
      const csv = "PLAY #,DN,DIST,OFF FORM,OFF PLAY,DEF FRONT\n1,3,6,Trips Rt,,\n2,1,10,,IZ,\n";
      const cards = parseHudlCsvText(csv).cards;
      expect(cards.map((c) => [c.formation, c.playCall, c.defFront])).toEqual([
        ["Trips Rt", "", ""],
        ["", "IZ", ""],
      ]);
    });

    it("keeps rows that only have a play # and down", () => {
      const csv = "PLAY #,DN,DIST,OFF FORM,OFF PLAY,DEF FRONT\n1,3,6,,,\n2,1,10,,,\n";
      expect(parseHudlCsvText(csv).cards.map((c) => c.downDistance)).toEqual(["3rd & 6", "1st & 10"]);
    });

    it("keeps a row whose only data is RESULT", () => {
      const [card] = parseHudlCsvText("PLAY #,ODK,OFF FORM,OFF PLAY,RESULT\n,O,,,Gain 6\n").cards;
      expect(card).toMatchObject({ playNumber: 1, result: "Gain 6" });
    });
  });

  describe("short and messy header names", () => {
    it("maps H, YARD, FORM, and FRONT", () => {
      const result = parseHudlCsvText("DN,DIST,H,YARD,FORM,OFF_PLAY,FRONT\n3,6,L,-35,Trips Rt,Slant,4-3\n");
      expect(result.cards[0]).toMatchObject({
        hash: "L",
        yardLine: -35,
        formationKey: "trips",
        concept: "slant",
        frontKey: "4-3",
      });
    });

    it("maps underscored and padded headers", () => {
      const result = parseHudlCsvText("  play #  , dn ,OFF_FORM, off_play ,  DEF_FRONT \n1,3,Trips Rt,Slant,4-3\n");
      expect(result.missingColumns).toEqual(["distance", "hash"]);
      expect(result.cards[0]).toMatchObject({ formation: "Trips Rt", playCall: "Slant", defFront: "4-3" });
    });

    it("reads a bare PLAY column of names as the play call", () => {
      const result = parseHudlCsvText("DN,FORM,PLAY,FRONT\n3,Trips Rt,Slant,4-3\n1,Spread,IZ,4-3\n");
      expect(result.columns.playCall).toBe("PLAY");
      expect(result.columns.playNumber).toBeUndefined();
      expect(result.cards.map((c) => [c.playNumber, c.playCall])).toEqual([
        [1, "Slant"],
        [2, "IZ"],
      ]);
    });

    it("reads a bare PLAY column of numbers as the play number", () => {
      const result = parseHudlCsvText("PLAY,DN,OFF FORM,OFF PLAY\n12,3,Trips Rt,Slant\n13,1,Spread,IZ\n");
      expect(result.columns.playNumber).toBe("PLAY");
      expect(result.cards.map((c) => c.playNumber)).toEqual([12, 13]);
    });
  });

  describe("files that aren't CSV", () => {
    it("recognizes an Apple Numbers file saved with a .csv name", () => {
      const numbers = "PK\u0003\u0004\u0014\u0000\u0000\u0000Index/Document.iwa\u0000\u0008binary...";
      const result = parseHudlCsvText(numbers);
      expect(result.unsupportedFile?.kind).toBe("numbers");
      expect(result.unsupportedFile?.message).toMatch(/File → Export To → CSV/);
      expect(result.cards).toEqual([]);
    });

    it("recognizes an Excel .xlsx saved with a .csv name", () => {
      expect(detectUnsupportedFile("PK\u0003\u0004\u0014\u0000[Content_Types].xml xl/workbook.xml")?.kind).toBe("excel");
    });

    it("recognizes other binary files", () => {
      expect(detectUnsupportedFile("\u0001\u0002\u0003\u0004".repeat(10))?.kind).toBe("binary");
    });

    it("leaves real CSV text alone, including UTF-16 decoded with NULs", () => {
      expect(detectUnsupportedFile(MOCK_HUDL_CSV)).toBeNull();
      expect(detectUnsupportedFile("P\u0000L\u0000A\u0000Y\u0000 \u0000#\u0000,\u0000".repeat(20))).toBeNull();
    });
  });

  describe("real staff file (OFF STR / PLAY DIR columns)", () => {
    const csv = `PLAY #,ODK,DN,DIST,YARD LN,HASH,OFF FORM,OFF PLAY,OFF STR,PLAY DIR,DEF FRONT,COVERAGE
1,O,1,10,-40,R,TRIO,QB LEAD DRAW,R,L,,
2,O,2,7,-37,L,DUCES,READ POWER,BAL,L,,
10,O,1,10,28,R,ACES OFF,QB B power,BAL,R,,
21,O,1,10,25,R,TRIO,SPEED OPTION,L,R,EVEN,7 - ALL LBS
35,O,1,10,-35,L,TRIO,,L,R,ODD,4 - 2 OLB
`;
    it("uses OFF STR and PLAY DIR and the staff's terms", () => {
      const cards = parseHudlCsvText(csv).cards;
      expect(
        cards.map((c) => [c.playNumber, c.formationKey, c.formationSide, c.concept, c.playDirection, c.frontKey]),
      ).toEqual([
        [1, "trips", "right", "qb-run", "left", "unknown"],
        [2, "spread", "right", "power", "left", "unknown"],
        [10, "spread", "right", "qb-run", "right", "unknown"],
        [21, "trips", "left", "sweep", "right", "4-3"],
        [35, "trips", "left", "unknown", "right", "3-4"],
      ]);
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

describe("buildDiagram (offense only)", () => {
  const card = (formationKey: FormationKey, playCall: string, dir: "left" | "right" = "right") => {
    const parsed = parseHudlCsvText(`OFF FORM,OFF PLAY\n${formationKey},${playCall}\n`).cards[0];
    return { ...parsed, formationKey, formationSide: dir, playDirection: dir };
  };
  const labels = (d: ReturnType<typeof buildDiagram>) => d.players.map((p) => p.label).filter(Boolean).sort();

  it("draws 11 on offense, linemen unlabeled, skill players Q F H X Y Z", () => {
    for (const key of ["spread", "trips", "i-form", "double-eagle", "pro"] as const) {
      const d = buildDiagram(card(key, "IZ"));
      expect(d.players).toHaveLength(11);
      expect(d.players.filter((p) => p.role === "OL" && p.label === "")).toHaveLength(5);
      expect(labels(d)).toEqual(["F", "H", "Q", "X", "Y", "Z"]);
    }
  });

  it("classifies run, pass, RPO, and play action", () => {
    const kind = (call: string) => buildDiagram(card("spread", call)).kind;
    expect(kind("READ POWER")).toBe("run");
    expect(kind("G ISO")).toBe("run");
    expect(kind("SPEED OPTION")).toBe("run");
    expect(kind("FADE OUT OUT FADE")).toBe("pass");
    expect(kind("RPO BUBBLE")).toBe("rpo");
    expect(kind("PA TE LEAK")).toBe("pa");
    expect(kind("")).toBe("none");
  });

  it("zone: every lineman reaches playside, receivers stalk, back carries", () => {
    const d = buildDiagram(card("spread", "INSIDE ZONE"));
    expect(runScheme({ playCall: "INSIDE ZONE", concept: "inside-zone" })).toBe("zone");
    const lineBlocks = d.blocks.filter((b) => b[0].y === 150 && b[0].x >= 206 && b[0].x <= 294);
    expect(lineBlocks).toHaveLength(5);
    expect(lineBlocks.every((b) => b[b.length - 1].x > b[0].x)).toBe(true); // stepping right
    expect(d.pulls).toEqual([]);
    expect(d.carrier).not.toBeNull();
    expect(d.routes).toEqual([]);
  });

  it("power / G ISO: backside guard pulls, frontside blocks down", () => {
    for (const call of ["POWER", "G ISO", "READ POWER"]) {
      expect(runScheme({ playCall: call, concept: "power" })).toBe("power");
      const d = buildDiagram(card("i-form", call));
      expect(d.pulls).toHaveLength(1);
      expect(d.pulls[0][0]).toEqual({ x: 228, y: 150 }); // left guard pulls on a play to the right
    }
    expect(buildDiagram(card("i-form", "COUNTER", "left")).pulls).toHaveLength(2);
  });

  it("iso / lead: center and guards climb, fullback leads", () => {
    const d = buildDiagram(card("i-form", "ISO"));
    const climbs = d.blocks.filter((b) => b[0].y === 150 && Math.abs(b[0].x - 250) <= 22);
    expect(climbs).toHaveLength(3);
    expect(climbs.every((b) => b[b.length - 1].y <= 104)).toBe(true);
    expect(d.blocks.some((b) => b[0].x === 250 && b[0].y === 198)).toBe(true); // F leads
  });

  it("reads a multi-route call left to right across the receivers", () => {
    const d = buildDiagram(card("spread", "FADE OUT OUT FADE"));
    expect(d.routes).toHaveLength(4);
    const byStart = [...d.routes].sort((a, b) => a[0].x - b[0].x);
    expect(byStart[0][byStart[0].length - 1].y).toBeLessThan(40); // X fades
    expect(byStart[1][2].y).toBe(104); // H out
    expect(d.blocks).toEqual([]); // no run blocking on a pass
  });

  it("RPO and play action draw the mesh fake plus routes", () => {
    const rpo = buildDiagram(card("trips", "RPO BUBBLE"));
    expect(rpo.fakes.length).toBeGreaterThan(0);
    expect(rpo.routes).toHaveLength(1); // bubble to the play-side slot
    const pa = buildDiagram(card("pro", "PA TE LEAK"));
    expect(pa.fakes.length).toBeGreaterThan(0);
    expect(pa.routes).toHaveLength(1);
  });

  it("7v7 drops the offensive line and its blocks", () => {
    const d = buildDiagram(card("trips", "RPO BUBBLE"), "7v7");
    expect(d.players.some((p) => p.role === "OL")).toBe(false);
    expect(labels(d)).toEqual(["F", "H", "Q", "X", "Y", "Z"]);
    expect(d.blocks.every((b) => b[0].y !== 150 || b[0].x < 206 || b[0].x > 294)).toBe(true);
    expect(d.routes.length).toBeGreaterThan(0);
  });

  it("mirrors a left-handed formation", () => {
    const xs = (d: ReturnType<typeof buildDiagram>) => d.players.map((p) => p.x).sort((a, b) => a - b);
    const right = buildDiagram(card("trips", "", "right"));
    const left = buildDiagram(card("trips", "", "left"));
    expect(xs(left)).toEqual(xs(right).map((x) => 500 - x).sort((a, b) => a - b));
  });

  describe("scout defense", () => {
    const withFront = (formationKey: FormationKey, front: string, dir: "left" | "right" = "right") => {
      const parsed = parseHudlCsvText(`OFF FORM,OFF PLAY,DEF FRONT\n${formationKey},IZ,${front}\n`).cards[0];
      return { ...parsed, formationKey, formationSide: dir, playDirection: dir };
    };

    it("team: 11 on 11, with the formation but no offensive assignments", () => {
      const d = buildDiagram(withFront("trips", "EVEN"), "team", "defense");
      expect(d.players).toHaveLength(11);
      expect(d.defense).toHaveLength(11);
      expect(d.defense.map((p) => p.label).sort()).toEqual(["C", "C", "E", "E", "FS", "M", "S", "SS", "T", "T", "W"]);
      expect([d.blocks, d.routes, d.pulls, d.fakes]).toEqual([[], [], [], []]);
      expect(d.carrier).toBeNull();
    });

    it("7v7: no linemen on either side", () => {
      const d = buildDiagram(withFront("spread", "4-3"), "7v7", "defense");
      expect(d.players.some((p) => p.role === "OL")).toBe(false);
      expect(d.defense.map((p) => p.label).sort()).toEqual(["C", "C", "FS", "M", "S", "SS", "W"]);
    });

    it("an unknown front draws a 4-3 and flags it", () => {
      expect(buildDiagram(withFront("pro", "COVER 3"), "team", "defense").frontFallback).toBe(true);
    });

    it("never stacks two defenders on the same spot", () => {
      for (const key of ["spread", "trips", "i-form", "double-eagle", "pro"] as const) {
        for (const front of ["4-3", "3-4", "5-2", "BEAR"]) {
          for (const dir of ["left", "right"] as const) {
            const { defense } = buildDiagram(withFront(key, front, dir), "team", "defense");
            for (let i = 0; i < defense.length; i++) {
              for (let j = i + 1; j < defense.length; j++) {
                const gap = Math.hypot(defense[i].x - defense[j].x, defense[i].y - defense[j].y);
                expect(gap, `${key} ${dir} vs ${front}`).toBeGreaterThan(18);
              }
            }
          }
        }
      }
    });

    it("reads COVERAGE onto the card", () => {
      const [c] = parseHudlCsvText("OFF FORM,DEF FRONT,COVERAGE\nTRIO,EVEN,6 - DOUBLE FIRE\n").cards;
      expect(c.coverage).toBe("6 - DOUBLE FIRE");
    });
  });

  it("keeps plays with isPassPlay for 7v7", () => {
    expect(isPassPlay({ playCall: "SLANT", concept: "slant" })).toBe(true);
    expect(isPassPlay({ playCall: "G ISO", concept: "power" })).toBe(false);
  });
});

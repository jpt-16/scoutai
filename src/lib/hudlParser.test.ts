import { describe, expect, it } from "vitest";
import { MOCK_HUDL_CSV } from "./demoScript";
import { insideAlignment, isWingSlideCall, WING_MAX_SPLIT_YARDS } from "./conceptMapper";
import {
  buildAssignments,
  buildDiagram,
  fromCardPoint,
  inPeriod,
  isPassPlay,
  routeTokens,
  runScheme,
} from "./formations";
import {
  classifyConcept,
  type FormationKey,
  classifyFormation,
  classifyFront,
  detectUnsupportedFile,
  sanitizeCsvInput,
  mapColumns,
  parseExcelFile,
  parseHash,
  parseHudlCsv,
  parseHudlCsvText,
  parseYardLine,
  repairCsvLine,
  findRunPassColumn,
  realignRow,
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
    ["Split Back", "split-pro"],
    ["PRO SPLIT", "split-pro"],
    ["Split Pro Rt", "split-pro"],
    ["PRO", "pro"],
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
    for (const key of ["spread", "trips", "i-form", "double-eagle", "pro", "split-pro"] as const) {
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
    const lineBlocks = d.blocks.filter((b) => b[0].y === 148 && b[0].x >= 206 && b[0].x <= 294);
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
      expect(d.pulls[0][0]).toEqual({ x: 228, y: 148 }); // left guard pulls on a play to the right
    }
    expect(buildDiagram(card("i-form", "COUNTER", "left")).pulls).toHaveLength(2);
  });

  it("reads TREY as counter trey: guard kicks out wide, tackle wraps inside, lanes apart", () => {
    expect(runScheme({ playCall: "TREY", concept: "power" })).toBe("counter");
    expect(parseHudlCsvText("OFF FORM,OFF PLAY\nDUCES,TREY\n").cards[0].concept).toBe("power");
    expect(classifyFormation("TREY RT")).toBe("trips"); // as a formation, trey = trips
    for (const key of ["spread", "pro"] as const) {
      const d = buildDiagram(card(key, "TREY"));
      expect(d.pulls).toHaveLength(2);
      const guard = d.pulls.find((p) => p[0].x === 228)!; // left guard (play goes right)
      const tackle = d.pulls.find((p) => p[0].x === 206)!; // left tackle
      expect(guard).toBeDefined();
      expect(tackle).toBeDefined();
      expect(Math.abs(guard[1].y - tackle[1].y)).toBeGreaterThanOrEqual(8); // separate lanes
      const gEnd = guard[guard.length - 1];
      const tEnd = tackle[tackle.length - 1];
      expect(gEnd.x - tEnd.x).toBeGreaterThanOrEqual(40); // kick-out wide, wrap inside
      expect(tEnd.y).toBeLessThan(gEnd.y); // tackle climbs to the LB
    }
  });

  it("iso / lead: center and guards climb, fullback leads", () => {
    const d = buildDiagram(card("i-form", "ISO"));
    const climbs = d.blocks.filter((b) => b[0].y === 148 && Math.abs(b[0].x - 250) <= 22);
    expect(climbs).toHaveLength(3);
    expect(climbs.every((b) => b[b.length - 1].y <= 104)).toBe(true);
    expect(d.blocks.some((b) => b[0].x === 250 && b[0].y === 198)).toBe(true); // F leads
  });

  /** Route label per receiver letter, e.g. { X: "9", H: "3" }. */
  const routesBy = (d: ReturnType<typeof buildDiagram>) => {
    const out: Record<string, string> = {};
    d.routes.forEach((r, i) => {
      const who = d.players.find((p) => p.x === r[0].x && p.y === r[0].y);
      if (who) out[who.label] = d.routeLabels[i];
    });
    return out;
  };

  it("reads route words left to right across the receivers", () => {
    const d = buildDiagram(card("spread", "FADE OUT OUT FADE"));
    expect(routesBy(d)).toEqual({ X: "9", F: "3", Y: "3", Z: "9" });
    // A pass gets pass protection, never run blocking: every block steps back, not upfield.
    expect(d.blocks.length).toBeGreaterThan(0);
    expect(d.blocks.every((b) => b[b.length - 1].y > b[0].y - 1 || b[0].y > 150)).toBe(true);
  });

  it("route-tree numbers, one per receiver, read right to left", () => {
    // Spread, left to right: X F | Y Z. "2960" = Z 2, Y 9, F 6, X 0.
    expect(routesBy(buildDiagram(card("spread", "2960")))).toEqual({ Z: "2", Y: "9", F: "6", X: "0" });
    expect(routesBy(buildDiagram(card("spread", "2 9 6 0")))).toEqual({ Z: "2", Y: "9", F: "6", X: "0" });
  });

  it("fewer numbers than receivers are the same on both sides, outside in (81 = post / speed out)", () => {
    expect(routesBy(buildDiagram(card("spread", "81")))).toEqual({ X: "8", F: "1", Y: "1", Z: "8" });
    // Trips right: Z #1, Y #2, H #3 on the right; X #1 on the left.
    expect(routesBy(buildDiagram(card("trips", "964")))).toEqual({ Z: "9", Y: "6", H: "4", X: "9" });
  });

  it("a single number is run by every receiver, like a single route word", () => {
    expect(routesBy(buildDiagram(card("spread", "2")))).toEqual({ X: "2", F: "2", Y: "2", Z: "2" });
  });

  it("counts are not route numbers, and run numbers stay runs", () => {
    expect(routesBy(buildDiagram(card("spread", "4 VERTS")))).toEqual({ X: "GO", F: "GO", Y: "GO", Z: "GO" });
    expect(buildDiagram(card("i-form", "24 DIVE")).kind).toBe("run");
  });

  it("labels tree routes by number and calls out the rest by name", () => {
    const d = buildDiagram(card("spread", "SLANT CORNER WHEEL ACROSS"));
    expect(routesBy(d)).toEqual({ X: "2", F: "7", Y: "WHEEL", Z: "6" });
    expect(routeTokens("SPEED OUT")).toEqual(["speed-out"]);
  });

  it("MESH RAIL gives each position its own route, never one route for everyone", () => {
    const d = buildDiagram(card("spread", "MESH RAIL"));
    // Deuces going right: X F | Y Z, H in the backfield.
    expect(routesBy(d)).toEqual({ X: "8", F: "DRAG", H: "RAIL", Y: "DRAG", Z: "7" });
    expect(d.jobs.H).toMatch(/Rail/);
    const at = (label: string) => d.routes.find((r) => r[0].x === d.players.find((p) => p.label === label)!.x)!;
    // The drags cross over the ball in opposite directions inside 3-5 yards: F sets the mesh at 5, Y under at 3.
    const f = at("F");
    const y = at("Y");
    expect(140 - f[1].y).toBe(5 * 7);
    expect(140 - y[1].y).toBe(3 * 7);
    expect(f[2].x).toBeGreaterThan(250);
    expect(y[2].x).toBeLessThan(250);
    // The rail goes out to the backside flat, then straight up the sideline.
    const h = at("H");
    const top = h[h.length - 1];
    const turn = h[h.length - 2];
    expect(turn.x).toBe(top.x);
    expect(top.x).toBeLessThan(100);
    expect(top.y).toBeLessThan(140 - 15 * 7);
  });

  it("maps other concepts by position and mirrors them with the play direction", () => {
    expect(routesBy(buildDiagram(card("spread", "SMASH")))).toEqual({ X: "HITCH", F: "7", Y: "7", Z: "HITCH" });
    expect(routesBy(buildDiagram(card("trips", "FLOOD")))).toEqual({ Z: "GO", Y: "SAIL", H: "FLAT", X: "DIG" });
    expect(routesBy(buildDiagram(card("spread", "DAGGER")))).toMatchObject({ Z: "DIG", Y: "GO", X: "8" });
    // Going left, the play side flips: X is the play-side #1.
    const left = buildDiagram({ ...card("spread", "MESH RAIL"), playDirection: "left" });
    expect(routesBy(left)).toMatchObject({ X: "7", Z: "8", H: "RAIL" });
    // Extra route words go to the outside receivers; CROSS alone is the concept,
    // CROSS in a list of words is just a route.
    expect(routesBy(buildDiagram(card("spread", "MESH GO")))).toMatchObject({ X: "GO", Z: "GO", F: "DRAG", Y: "DRAG" });
    expect(routesBy(buildDiagram(card("spread", "CROSS")))).toMatchObject({ F: "CROSS", X: "8" });
    expect(routesBy(buildDiagram(card("spread", "FADE CROSS CROSS FADE")))).toEqual({ X: "9", F: "6", Y: "6", Z: "9" });
  });

  it("MESH and RAIL are separate: RAIL is the back's tag on any concept", () => {
    // Plain MESH: the same receivers' routes, and the back stays in to protect.
    const mesh = buildDiagram(card("spread", "MESH"));
    expect(routesBy(mesh)).toEqual({ X: "8", F: "DRAG", Y: "DRAG", Z: "7" });
    expect(mesh.jobs.H).toBe("Pass pro");
    // RAIL rides on another concept too.
    expect(routesBy(buildDiagram(card("spread", "SMASH RAIL")))).toEqual({
      X: "HITCH",
      F: "7",
      Y: "7",
      Z: "HITCH",
      H: "RAIL",
    });
  });

  it("a lone route word is a combination, not everyone running it", () => {
    // Trips right: Z #1, Y #2, H #3; X alone backside.
    const quick = buildDiagram(card("trips", "QUICK SLANT"));
    expect(routesBy(quick)).toEqual({ Z: "2", Y: "FLAT", H: "HITCH", X: "2" });
    expect(quick.jobs).toMatchObject({ Z: "2 Slant", Y: "Flat", H: "Hitch", X: "2 Slant" });
    expect(routesBy(buildDiagram(card("spread", "CURL")))).toEqual({ X: "4", F: "FLAT", Y: "FLAT", Z: "4" });
    expect(routesBy(buildDiagram(card("spread", "POST")))).toEqual({ X: "8", F: "DIG", Y: "DIG", Z: "8" });
    // An inside route goes to the #2s while the #1s clear.
    expect(routesBy(buildDiagram(card("spread", "FLAT")))).toEqual({ X: "GO", F: "FLAT", Y: "FLAT", Z: "GO" });
    // Verticals really are everyone, and tight ends still protect.
    expect(routesBy(buildDiagram(card("spread", "VERTS")))).toEqual({ X: "GO", F: "GO", Y: "GO", Z: "GO" });
    const pro = buildDiagram(card("pro", "SLANT"));
    expect(pro.jobs.Y).toBe("Pass pro");
  });

  it("names the whole play for the title when the call doesn't", () => {
    expect(buildDiagram(card("trips", "QUICK SLANT")).routeSummary).toBe("Slant / Flat / Hitch");
    expect(buildDiagram(card("spread", "CURL")).routeSummary).toBe("Curl / Flat");
    // The call already says it all.
    expect(buildDiagram(card("spread", "MESH RAIL")).routeSummary).toBeNull();
    expect(buildDiagram(card("trips", "836")).routeSummary).toBeNull();
    expect(buildDiagram(card("spread", "4 VERTS")).routeSummary).toBeNull();
    expect(buildDiagram(card("i-form", "POWER")).routeSummary).toBeNull();
    // A coach's own routes do too.
    const own = { ...card("spread", "SLANT"), routeOverrides: { X: { route: "fade" } } };
    expect(buildDiagram(own).routeSummary).toBe("Slant / Flat / Fade");
    // Scout D cards don't carry one.
    expect(buildDiagram(card("trips", "QUICK SLANT"), "team", "defense").routeSummary).toBeNull();
  });

  it("a lone WHEEL or RAIL goes to the back", () => {
    expect(routesBy(buildDiagram(card("spread", "WHEEL")))).toEqual({ H: "WHEEL" });
    expect(buildDiagram(card("spread", "RAIL")).kind).toBe("pass");
  });

  it("draws routes with sharp breaks at true field angles", () => {
    const d = buildDiagram(card("spread", "SLANT"));
    const z = d.routes.find((r) => r[0].x === 464)!; // Z, right side
    // Three hard steps and plant: a 3-yard stem straight up, then 45° inside
    // (equal yards across and up).
    expect(z[1].x).toBe(464);
    expect(z[1].y).toBe(140 - 3 * 7);
    const yardsAcross = (z[1].x - z[2].x) / (500 / (160 / 3));
    const yardsUp = (z[1].y - z[2].y) / 7;
    expect(yardsAcross).toBeCloseTo(yardsUp, 5);
    // OUT: 90° to the sideline at 10 yards.
    const out = buildDiagram(card("spread", "OUT")).routes.find((r) => r[0].x === 464)!;
    expect(out[1].y).toBe(out[2].y);
    expect(out[2].x).toBeGreaterThan(470);
    // POST breaks inside, CORNER breaks outside.
    const post = buildDiagram(card("spread", "POST")).routes.find((r) => r[0].x === 464)!;
    const corner = buildDiagram(card("spread", "CORNER")).routes.find((r) => r[0].x === 464)!;
    expect(post[2].x).toBeLessThan(post[1].x);
    expect(corner[2].x).toBeGreaterThan(corner[1].x - 0.001);
  });

  it("pass protection only in team: backs and TEs without a route protect", () => {
    const team = buildDiagram(card("pro", "FADE"));
    expect(team.jobs.F).toBe("Pass pro");
    expect(team.jobs.Y).toBe("Pass pro");
    const seven = buildDiagram(card("pro", "FADE"), "7v7");
    expect(seven.blocks).toEqual([]);
  });

  it("builds the assignment table for runs, passes, and scout defense", () => {
    const power = buildDiagram(card("pro", "POWER"));
    const runRows = buildAssignments({ defFront: "", coverage: "", notes: "" }, power);
    expect(runRows.map((r) => r.key)).toEqual(["Y", "PST", "PSG", "C", "BSG", "BST", "NOTES"]);
    expect(runRows.find((r) => r.key === "BSG")!.text).toMatch(/Pull/);
    expect(runRows.find((r) => r.key === "Y")!.text).toBe("Down");

    const pass = buildDiagram(card("spread", "81"));
    const passRows = buildAssignments({ defFront: "", coverage: "", notes: "Hot vs blitz" }, pass);
    expect(passRows.map((r) => [r.key, r.text])).toEqual([
      ["X", "8 Post"],
      ["H", "Pass pro"],
      ["Y", "1 Speed out"],
      ["Z", "8 Post"],
      ["F", "1 Speed out"],
      ["OL", "Pass pro"],
      ["NOTES", "Hot vs blitz"],
    ]);

    // A coach's own words win over the generated text.
    const custom = buildAssignments(
      { defFront: "", coverage: "", notes: "", assignmentNotes: { PST: "Down on 3-tech" } },
      power,
    );
    expect(custom.find((r) => r.key === "PST")).toMatchObject({ text: "Down on 3-tech", custom: true });

    const def = buildDiagram({ ...card("trips", ""), frontKey: "4-3" as const }, "team", "defense");
    expect(buildAssignments({ defFront: "EVEN", coverage: "COVER 3", notes: "" }, def).map((r) => r.text)).toEqual([
      "EVEN",
      "COVER 3",
      // What the alignment rules did against trips, until a coach writes a note.
      "SS apex Y · S apex H · FS middle",
    ]);
  });

  it("a coach can change any letter's route and tag it", () => {
    const base = card("spread", "81");
    const d = buildDiagram({
      ...base,
      routeOverrides: { X: { route: "corner" }, F: { route: "wheel", tag: "HOT" }, H: { route: "none" } },
    });
    expect(routesBy(d)).toEqual({ X: "7", Y: "1", Z: "8", F: "HOT" });
    expect(d.jobs).toMatchObject({ X: "7 Corner", H: "—", F: "Wheel · HOT" });
    const rows = buildAssignments({ defFront: "", coverage: "", notes: "" }, d);
    expect(rows.find((r) => r.key === "F")!.text).toBe("Wheel · HOT");
  });

  it("stalk and tag-only overrides", () => {
    const d = buildDiagram({
      ...card("spread", "SLANT"),
      routeOverrides: { Z: { route: "stalk" }, X: { tag: "SIGHT" } },
    });
    // SLANT is slant / flat: the slots run flats inside the #1s' slants.
    expect(routesBy(d)).toEqual({ X: "SIGHT", F: "FLAT", Y: "FLAT" });
    expect(d.jobs.Z).toBe("Stalk");
    expect(d.jobs.X).toBe("2 Slant · SIGHT");
  });

  it("routes on an untagged play make it a pass, listed in Team", () => {
    const untagged = card("trips", "");
    expect(buildDiagram(untagged).kind).toBe("none");
    const withRoutes = { ...untagged, routeOverrides: { Z: { route: "fade" } } };
    expect(buildDiagram(withRoutes).kind).toBe("pass");
    expect(inPeriod(withRoutes, "team", "offense")).toBe(true);
    expect(inPeriod(untagged, "team", "offense")).toBe(false);
  });

  it("RPO and play action draw the mesh fake plus routes", () => {
    const rpo = buildDiagram(card("trips", "RPO BUBBLE"));
    expect(rpo.fakes.length).toBeGreaterThan(0);
    expect(rpo.routes).toHaveLength(1); // bubble to the play-side slot
    const pa = buildDiagram(card("pro", "PA TE LEAK"));
    expect(pa.fakes.length).toBeGreaterThan(0);
    expect(pa.routes).toHaveLength(1);
  });

  it("trips bubble: the other two ball-side receivers block the LB and the S/C", () => {
    const d = buildDiagram(card("trips", "RPO BUBBLE"));
    expect(d.routes).toHaveLength(1);
    const [lb, sc] = d.targetBlocks;
    expect(d.targetBlocks.map((t) => t.target)).toEqual(["LB", "S/C"]);
    // Trips right: the LB blocker (inside receiver) goes up then back inside.
    expect(lb.path[0].x).toBe(400);
    expect(lb.path[lb.path.length - 1].x).toBeLessThan(lb.path[0].x);
    // The S/C blocker (outside receiver) climbs deeper than the LB block.
    expect(sc.path[0].x).toBe(464);
    expect(sc.path[sc.path.length - 1].y).toBeLessThan(lb.path[lb.path.length - 1].y);
    // Backside X just stalks.
    expect(d.blocks.some((b) => b[0].x === 36)).toBe(true);
    // Same assignments survive in 7v7, and for a plain SCREEN call.
    expect(buildDiagram(card("trips", "RPO BUBBLE"), "7v7").targetBlocks).toHaveLength(2);
    expect(buildDiagram(card("trips", "SCREEN")).targetBlocks.map((t) => t.target)).toEqual(["LB", "S/C"]);
  });

  it("2x2 bubble: the lone ball-side blocker takes the corner", () => {
    const d = buildDiagram(card("spread", "BUBBLE"));
    expect(d.targetBlocks.map((t) => t.target)).toEqual(["C"]);
  });

  it("Pro stacks F behind Q and H behind F; Split Pro sets them side by side", () => {
    const backs = (key: FormationKey) =>
      buildDiagram(card(key, ""))
        .players.filter((p) => p.label === "F" || p.label === "H")
        .map((p) => [p.label, p.x, p.y]);
    expect(backs("pro")).toEqual([
      ["F", 250, 198],
      ["H", 250, 230],
    ]);
    expect(backs("split-pro")).toEqual([
      ["F", 222, 206],
      ["H", 278, 206],
    ]);
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
      for (const key of ["spread", "trips", "i-form", "double-eagle", "pro", "split-pro"] as const) {
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

    it("flips the card so the defense is on the bottom, seen from the defense", () => {
      const d = buildDiagram(withFront("trips", "EVEN"), "team", "defense");
      expect(d.flipped).toBe(true);
      expect(d.losY).toBe(160);
      expect(d.defense.every((p) => p.y > d.losY)).toBe(true);
      expect(d.players.every((p) => p.y < d.losY)).toBe(true);
      // Trips to the offense's right shows up on the defense's left.
      const receivers = d.players.filter((p) => ["H", "Y", "Z"].includes(p.label));
      expect(receivers.every((p) => p.x < 250)).toBe(true);
      // Scout offense cards are not flipped.
      expect(buildDiagram(withFront("trips", "EVEN")).flipped).toBe(false);
    });

    it("moved defenders stay where the coach put them, in team and 7v7", () => {
      const base = withFront("trips", "EVEN");
      const fs = buildDiagram(base, "team", "defense").defense.find((p) => p.label === "FS")!;
      const moved = { ...base, defenseOverrides: { [fs.id]: { x: 200, y: 30 } } };
      for (const mode of ["team", "7v7"] as const) {
        const d = buildDiagram(moved, mode, "defense");
        const again = d.defense.find((p) => p.id === fs.id)!;
        // Drawn flipped, so convert back before comparing.
        expect(fromCardPoint(d, again)).toEqual({ x: 200, y: 30 });
      }
    });

    it("a dragged spot converts back to saved coordinates on a flipped, right-hash card", () => {
      const card = { ...withFront("spread", "4-3"), hash: "R" as const };
      const d = buildDiagram(card, "team", "defense");
      const saved = { ...card, defenseOverrides: {} as Record<string, { x: number; y: number }> };
      for (const p of d.defense) saved.defenseOverrides[p.id] = fromCardPoint(d, p);
      const redrawn = buildDiagram(saved, "team", "defense");
      redrawn.defense.forEach((p, i) => {
        expect(Math.abs(p.x - d.defense[i].x)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.y - d.defense[i].y)).toBeLessThanOrEqual(1);
      });
    });

    it("reads COVERAGE onto the card", () => {
      const [c] = parseHudlCsvText("OFF FORM,DEF FRONT,COVERAGE\nTRIO,EVEN,6 - DOUBLE FIRE\n").cards;
      expect(c.coverage).toBe("6 - DOUBLE FIRE");
    });
  });

  it("7v7 periods: every pass from team, untagged reps for Scout O, every look for Scout D", () => {
    const csv = `PLAY #,OFF FORM,OFF PLAY,PLAY DIR,DEF FRONT
1,TRIO,G ISO,L,EVEN
2,TRIO,FADE OUT OUT FADE,N,EVEN
3,PRO,,N,EVEN
4,ACES OFF,,R,ODD
5,PRO,ISO,R,
`;
    const cards = parseHudlCsvText(csv).cards;
    expect(cards[2].concept).toBe("dropback"); // blank play + PLAY DIR N = pass
    const list = (period: "all" | "7v7" | "team", unit: "offense" | "defense") =>
      cards.filter((c) => inPeriod(c, period, unit)).map((c) => c.playNumber);
    expect(list("team", "offense")).toEqual([1, 2, 3, 5]);
    expect(list("7v7", "offense")).toEqual([2, 3, 4]);
    expect(list("7v7", "defense")).toEqual([1, 2, 3, 4, 5]);
    // Every team pass is also in 7v7.
    const team = cards.filter((c) => inPeriod(c, "team", "offense") && isPassPlay(c));
    expect(team.every((c) => inPeriod(c, "7v7", "offense"))).toBe(true);
  });

  it("puts the ball on its hash without pushing anyone off the field or into each other", () => {
    for (const key of ["spread", "trips", "i-form", "double-eagle", "pro", "split-pro"] as const) {
      for (const hash of ["L", "M", "R"] as const) {
        for (const dir of ["left", "right"] as const) {
          const d = buildDiagram({ ...card(key, "", dir), hash });
          const ball = d.players.find((p) => p.ball)!;
          expect(ball.x).toBe({ L: 167, M: 250, R: 333 }[hash]);
          for (const p of d.players) expect(p.x).toBeGreaterThanOrEqual(12);
          for (const p of d.players) expect(p.x).toBeLessThanOrEqual(488);
          for (let i = 0; i < d.players.length; i++) {
            for (let j = i + 1; j < d.players.length; j++) {
              const a = d.players[i];
              const b = d.players[j];
              // A QB under center sits right behind the center on purpose.
              if ((a.ball && b.role === "QB") || (b.ball && a.role === "QB")) continue;
              expect(Math.hypot(a.x - b.x, a.y - b.y), `${key} ${hash} ${dir}`).toBeGreaterThan(18);
            }
          }
        }
      }
    }
  });

  it("draws true yard lines with field numbers every 10 yards", () => {
    const [own35] = parseHudlCsvText("YARD LN,OFF FORM\n-35,SPREAD\n").cards;
    const d = buildDiagram(own35);
    const labels = d.yardLines.filter((l) => l.label).map((l) => l.label);
    expect(labels).toEqual(expect.arrayContaining(["40", "30"]));
    // The ball is on the 35: halfway between the 30 and 40 lines.
    const y30 = d.yardLines.find((l) => l.label === "30")!.y;
    const y40 = d.yardLines.find((l) => l.label === "40")!.y;
    expect(Math.abs(d.losY - (y30 + y40) / 2)).toBeLessThan(0.01);
    // Opponent's 8: the goal line shows.
    const [opp8] = parseHudlCsvText("YARD LN,OFF FORM\nOpp 8,SPREAD\n").cards;
    expect(buildDiagram(opp8).yardLines.some((l) => l.label === "G")).toBe(true);
  });

  it("keeps plays with isPassPlay for 7v7", () => {
    expect(isPassPlay({ playCall: "SLANT", concept: "slant" })).toBe(true);
    expect(isPassPlay({ playCall: "G ISO", concept: "power" })).toBe(false);
  });
});

describe("Excel import", () => {
  async function buildWorkbookBuffer(rows: (string | number)[][], sheetName = "Breakdown"): Promise<Uint8Array> {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName);
    rows.forEach((row) => sheet.addRow(row));
    return new Uint8Array(await workbook.xlsx.writeBuffer());
  }

  it("parses a real .xlsx workbook the same as an equivalent CSV", async () => {
    const buffer = await buildWorkbookBuffer([
      ["PLAY #", "DN", "DIST", "OFF FORM", "OFF PLAY"],
      [1, 1, 10, "SPREAD", "SLANT"],
      [2, 2, 7, "TRIPS", "FADE"],
    ]);
    const file = new File([buffer as BlobPart], "breakdown.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const result = await parseHudlCsv(file);
    expect(result.cards).toHaveLength(2);
    expect(result.cards[0]).toMatchObject({ playNumber: 1, formation: "SPREAD", playCall: "SLANT" });
    expect(result.cards[1]).toMatchObject({ playNumber: 2, formation: "TRIPS", playCall: "FADE" });
  });

  it("parses an Excel file even when it's misnamed with a .csv extension", async () => {
    const buffer = await buildWorkbookBuffer([
      ["PLAY #", "OFF FORM", "OFF PLAY"],
      [1, "TRIPS", "SLANT"],
    ]);
    const file = new File([buffer as BlobPart], "breakdown.csv");
    const result = await parseHudlCsv(file);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].formation).toBe("TRIPS");
  });

  it("warns when a workbook has more than one sheet and only reads the first", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const sheet1 = workbook.addWorksheet("Offense");
    sheet1.addRow(["PLAY #", "OFF FORM", "OFF PLAY"]);
    sheet1.addRow([1, "SPREAD", "SLANT"]);
    workbook.addWorksheet("Defense"); // second sheet, deliberately left unread
    const buffer = new Uint8Array(await workbook.xlsx.writeBuffer());
    const result = await parseExcelFile(new Blob([buffer]));
    expect(result.cards).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/2 sheets.*Offense/);
  });

  it("reports a friendly error for a corrupt/unreadable Excel file", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "broken.xlsx");
    const result = await parseHudlCsv(file);
    expect(result.cards).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/couldn't read this excel file/i);
  });
});

describe("hand-typed breakdowns that slid out of their columns", () => {
  // Rows from a staff's own Google Sheet: Run / Pass typed under G/L, play calls
  // typed across several cells, and an extra blank cell before the front.
  const CSV = `Untitled spreadsheet - Sheet1 (2)
PLAY #,ODK,DN,DIST,YARD LN,TYPE,G/L,OFF FORM,OFF PLAY,OFF STR,PLAY DIR,GAP,DEF FRONT,COVERAGE,RUTZ,,
1,O,1,10,-21,,Run,ACES,G ISO,L,R,,,,,,
7,O,2,8,-36,,Run,TRIO,G ISO,L,L,,EVEN,6 - DOUBLE FIRE,1,,
8,O,3,8,-36,,Pass,TRIO,,,L,N,,EVEN,5 - DOUBLE FIRE,1,
15,O,4,1,-25,,Pass,BLACK,POST,SEAM,UNDER,WHEEL,RAIL,BAL,R,,
90,O,3,7,43,,Pass,TRIO,DIG,OUT,R,L,,ODD,4,4,
97,O,2,10,3,,Run,29,SLOT,,,R,L,,ODD,4,4
`;
  const result = parseHudlCsvText(CSV);
  const byNumber = (n: number) => result.cards.find((c) => c.playNumber === n)!;

  it("reads Run / Pass from whatever column it was typed in", () => {
    expect(result.columns.playType).toBe("G/L");
    expect(byNumber(8).playType).toBe("Pass");
    expect(byNumber(1).playType).toBe("Run");
    expect(result.warnings.some((w) => w.includes('"G/L"'))).toBe(true);
  });

  it("joins a play call typed across cells and puts strength / direction back", () => {
    expect(byNumber(15)).toMatchObject({ playCall: "POST SEAM UNDER WHEEL RAIL", offStrength: "BAL", playDir: "R", defFront: "" });
    expect(byNumber(90)).toMatchObject({ playCall: "DIG OUT", offStrength: "R", playDir: "L", defFront: "ODD", coverage: "4" });
  });

  it("drops an extra blank cell so the front lands under DEF FRONT", () => {
    expect(byNumber(8)).toMatchObject({ offStrength: "L", playDir: "N", defFront: "EVEN", coverage: "5 - DOUBLE FIRE" });
    expect(byNumber(97)).toMatchObject({ offStrength: "R", playDir: "L", defFront: "ODD", coverage: "4" });
  });

  it("leaves rows that were already right alone", () => {
    expect(byNumber(7)).toMatchObject({ playCall: "G ISO", offStrength: "L", playDir: "L", defFront: "EVEN", coverage: "6 - DOUBLE FIRE" });
    expect(result.warnings.some((w) => w.startsWith("Lined up 4 rows"))).toBe(true);
  });

  it("never realigns a plain Hudl export", () => {
    const at = { playCall: 1, offStrength: 2, playDir: 3, defFront: 4 };
    expect(realignRow(["TRIO", "G ISO", "L", "R", "4-3"], at)).toEqual({ values: ["TRIO", "G ISO", "L", "R", "4-3"], fixed: false });
    expect(realignRow(["TRIO", "G ISO", "", "", ""], at).fixed).toBe(false);
  });

  it("doesn't mistake a direction column for Run / Pass", () => {
    expect(findRunPassColumn(["DIR"], [["R"], ["R"], ["L"], ["R"]], {})).toBeNull();
  });
});

describe("bubble and the line of scrimmage", () => {
  const card = (formationKey: "trips" | "spread", playDir: "L" | "R") =>
    parseHudlCsvText(`PLAY #,OFF FORM,OFF PLAY,OFF STR,PLAY DIR\n1,${formationKey},RPO BUBBLE,L,${playDir}\n`).cards[0];

  it("arcs a bubble out toward the sideline, behind the line, drawn as a curve", () => {
    for (const dir of ["L", "R"] as const) {
      const d = buildDiagram(card("trips", dir));
      const i = d.routeLabels.indexOf("BUBBLE");
      expect(i).toBeGreaterThanOrEqual(0);
      expect(d.routeCurves[i]).toBe(true);
      const path = d.routes[i];
      const start = path[0];
      const out = Math.sign(start.x - 250); // away from the ball
      for (let k = 1; k < path.length; k++) {
        // Every point moves further toward the sideline, never back toward the Q.
        expect((path[k].x - path[k - 1].x) * out).toBeGreaterThan(0);
        expect(path[k].y).toBeGreaterThan(140); // still behind the line
      }
      expect(d.routeCurves.filter(Boolean)).toHaveLength(1); // only the bubble is curved
    }
  });

  it("puts every on-ball player's front edge on the LOS bar's back edge, off-ball receivers 1-2 yards back", () => {
    const d = buildDiagram(card("spread", "L"));
    const front = (p: { y: number; label: string; role: string }) => p.y - (p.label ? 11 : 9);
    const onBall = d.players.filter((p) => p.role === "OL" || (p.role !== "QB" && p.role !== "RB" && p.y <= 150));
    for (const p of onBall) expect(front(p)).toBe(139);
    const offBall = d.players.filter((p) => p.role === "WR" && p.y > 150);
    for (const p of offBall) {
      const yards = (front(p) - 139) / 7;
      expect(yards).toBeGreaterThanOrEqual(1);
      expect(yards).toBeLessThanOrEqual(2);
    }
  });
});

describe("wing slide RPO", () => {
  const card = (formation: string, call: string, playDir: "L" | "R" = "R") =>
    parseHudlCsvText(`PLAY #,OFF FORM,OFF PLAY,PLAY DIR\n1,${formation},${call},${playDir}\n`).cards[0];
  const pathOf = (d: ReturnType<typeof buildDiagram>, label: string) => d.routes[d.routeLabels.indexOf(label)];

  it("reads RPO SLIDE / WING SLIDE / WING FLAT as the RPO, a plain SLIDE as tree 0", () => {
    expect(isWingSlideCall("RPO SLIDE")).toBe(true);
    expect(isWingSlideCall("Wing Slides Rt")).toBe(true);
    expect(isWingSlideCall("WING FLAT")).toBe(true);
    expect(isWingSlideCall("RPO SLIDE / WING FLAT")).toBe(true); // the film AI's tag
    expect(isWingSlideCall("FADE OUT SLIDE")).toBe(false);
    expect(isWingSlideCall("RPO BUBBLE")).toBe(false);
    expect(buildDiagram(card("Ace", "WING FLAT")).kind).toBe("rpo");
    expect(buildDiagram(card("Ace", "0")).routeLabels).not.toContain("SLIDE");
  });

  it("checks the inside receiver's split: a flexed player off the line is a wing, wider is a slot", () => {
    expect(insideAlignment(2, true)).toBe("wing");
    expect(insideAlignment(2, false)).toBe("tight-end");
    expect(insideAlignment(WING_MAX_SPLIT_YARDS + 1, true)).toBe("slot");
    // Double Eagle: the wing just outside the tight end slides; the tight end blocks with the line.
    const eagle = buildDiagram(card("Double Eagle", "RPO SLIDE"));
    expect(eagle.jobs.Z).toBe("WING: slide to the flat");
    expect(eagle.jobs.Y).toBeUndefined();
    // Trips: #3 is 4½ yards off the tackle, a slot, so he slides without the WING tag.
    const trips = buildDiagram(card("Trips", "RPO SLIDE"));
    expect(trips.jobs.H).toBe("Slide to the flat");
  });

  it("slides flat to his own sideline 2-3 yards behind the line", () => {
    for (const dir of ["L", "R"] as const) {
      const d = buildDiagram(card("Double Eagle", "RPO SLIDE", dir));
      const path = pathOf(d, "SLIDE");
      const out = dir === "R" ? 1 : -1;
      expect(path).toHaveLength(3);
      for (let k = 1; k < path.length; k++) {
        expect((path[k].x - path[k - 1].x) * out).toBeGreaterThan(0); // toward the sideline
        const behind = (path[k].y - 140) / 7;
        expect(behind).toBeGreaterThanOrEqual(2);
        expect(behind).toBeLessThanOrEqual(3);
      }
    }
  });

  it("catches in the flat inside the next receiver out, never through him", () => {
    for (const [formation, dir] of [["Trips", "R"], ["Spread", "L"], ["Spread", "R"]] as const) {
      const d = buildDiagram(card(formation, "RPO SLIDE", dir));
      const path = pathOf(d, "SLIDE");
      const others = d.players.filter((q) => q.label && (q.x !== path[0].x || q.y !== path[0].y));
      const out = Math.sign(path[1].x - path[0].x);
      const end = path[path.length - 1];
      for (const pl of others) {
        // Nobody stands on the slide between its start and its catch point.
        const between = (pl.x - path[0].x) * out > 0 && (end.x - pl.x) * out > -11;
        if (between) expect(Math.abs(pl.y - end.y) > 22 || (end.x - pl.x) * out < -11).toBe(true);
      }
      expect(Math.abs(end.x - path[0].x)).toBeGreaterThanOrEqual(3 * (500 / (160 / 3)) - 0.01);
    }
  });

  it("cracks the alley and stalks the corner inside, from the receivers outside the slider", () => {
    const d = buildDiagram(card("Trips", "RPO SLIDE"));
    expect(d.targetBlocks.map((t) => t.target)).toEqual(["ALLEY", "C"]);
    expect(d.jobs.Y).toBe("Crack the alley defender");
    expect(d.jobs.Z).toBe("Stalk the corner, inside");
    for (const { path } of d.targetBlocks) {
      const end = path[path.length - 1];
      expect(end.x).toBeLessThan(path[0].x); // angled back inside, toward the ball
      expect(end.y).toBeLessThan(140); // past the line, at the perimeter defenders
    }
    expect(d.jobs.X).toBe("Stalk"); // backside
    expect(d.jobs.Q).toBe("Read: give or throw");
    // A lone receiver outside the slider (Spread's Z outside Y) cracks the alley.
    expect(buildDiagram(card("Spread", "RPO SLIDE")).targetBlocks.map((t) => t.target)).toEqual(["ALLEY"]);
  });
});

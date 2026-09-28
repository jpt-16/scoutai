import { describe, expect, it } from "vitest";
import { DEMO_CSV } from "./demoScript";
import { buildDiagram } from "./formations";
import {
  classifyConcept,
  classifyFormation,
  classifyFront,
  mapColumns,
  parseHash,
  parseHudlCsvText,
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
    const result = parseHudlCsvText(DEMO_CSV);
    expect(result.cards).toHaveLength(5);
    expect(result.missingColumns).toEqual([]);

    const third = result.cards[2];
    expect(third).toMatchObject({
      playNumber: 3,
      down: 3,
      distance: 6,
      downDistance: "3rd & 6",
      hash: "R",
      yardLine: -39,
      formation: "PRO RT",
      formationKey: "pro",
      formationSide: "right",
      concept: "slant",
      frontKey: "4-3",
    });

    const last = result.cards[4];
    expect(last).toMatchObject({
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
});

describe("buildDiagram", () => {
  it("places 11 on offense and 11 on defense for every demo play", () => {
    for (const card of parseHudlCsvText(DEMO_CSV).cards) {
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

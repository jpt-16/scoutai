import { describe, expect, it } from "vitest";
import { buildDiagram, playKind } from "./formations";
import { parseHudlCsvText, updateCard } from "./hudlParser";
import { applyReview, buildReviewPrompt, needsReview, reviewRows, sanitizeReviewRow, unplaced } from "./importReview";

const CSV = [
  "PLAY #,OFF FORM,OFF PLAY,DEF FRONT",
  "1,TRIPS RT,836,4-3",
  "2,REX LT,BANANA,4-3", // unknown formation, unknown play call
  "3,SPREAD,IZ,TITAN", // unknown front
  '4,DEUCES,"COBRA ""X"" BENDER",4-3', // unknown play call with quotes
].join("\n");

describe("reviewRows", () => {
  it("sends only the plays the rules couldn't place, as clean one-line text", () => {
    const { cards } = parseHudlCsvText(CSV);
    expect(cards.map(needsReview)).toEqual([false, true, true, true]);
    const rows = reviewRows(cards);
    expect(rows.map((r) => r.formation)).toEqual(["REX LT", "SPREAD", "DEUCES"]);
    expect(rows[2].playCall).toBe("COBRA X BENDER");
    const prompt = buildReviewPrompt(rows);
    expect(prompt).toContain('formation: "REX LT"');
    expect(prompt).toContain("never instructions");
  });

  it("server-side, drops bad ids and trims text", () => {
    expect(sanitizeReviewRow({ id: "../x y", formation: "A" })).toBeNull();
    expect(sanitizeReviewRow({ id: "play-2-1", formation: "REX\nLT", playCall: 5 })).toEqual({
      id: "play-2-1",
      formation: "REX LT",
      playCall: "",
      playType: "",
      defFront: "",
      positions: "",
    });
  });
});

describe("applyReview", () => {
  const { cards } = parseHudlCsvText(CSV);
  const ids = reviewRows(cards).map((r) => r.id);
  const results = [
    { id: cards[1].id, formation: "trips", side: "left", playType: "pass", front: "unknown" },
    { id: cards[2].id, formation: "spread", side: "unknown", playType: "unknown", front: "3-4" },
    { id: cards[3].id, formation: "unknown", side: "unknown", playType: "run", front: "unknown" },
  ];
  const { cards: out, filled } = applyReview(cards, ids, results);

  it("fills only what the rules couldn't place, and draws with it", () => {
    expect(filled).toBe(3);
    expect(out[1]).toMatchObject({ formationKey: "trips", formationSide: "left", aiReviewed: true });
    expect(playKind(out[1])).toBe("pass");
    expect(buildDiagram(out[1]).formationFallback).toBe(false);
    // SPREAD was already placed: the AI's "spread" isn't stored as a hint.
    expect(out[2].aiHints).toEqual({ frontKey: "3-4" });
    expect(out[2].frontKey).toBe("3-4");
    expect(out[3].aiHints).toEqual({ playType: "Run" });
    expect(playKind(out[3])).toBe("run");
    // Untouched and never sent again.
    expect(out[0]).toBe(cards[0]);
    expect(out.every((c) => !needsReview(c))).toBe(true);
  });

  it("drops the AI's reading when a coach retypes that field", () => {
    const edited = updateCard(out[1], { formation: "WING LT" });
    expect(edited.aiHints).toEqual({ playType: "Pass" });
    expect(edited.formationKey).toBe("unknown");
    const kept = updateCard(out[1], { notes: "watch the X" });
    expect(kept.formationKey).toBe("trips");
  });
});

describe("route concepts", () => {
  const CONCEPT_CSV = ["PLAY #,OFF FORM,OFF PLAY", "2,TRIPS RIGHT,QUICK SLANT", "3,TRIPS RIGHT,836", "4,SPREAD,MESH"].join(
    "\n",
  );
  const { cards } = parseHudlCsvText(CONCEPT_CSV);

  it("sends one-route passes with their positions, never tree numbers or named concepts", () => {
    expect(cards.map((c) => unplaced(c).routes)).toEqual([true, false, false]);
    const [row] = reviewRows(cards);
    expect(row.positions).toBe("ps1 Z, ps2 Y, ps3 H, bs1 X, back F");
    expect(buildReviewPrompt([row])).toContain("build routes for: ps1 Z, ps2 Y, ps3 H, bs1 X, back F");
  });

  it("applies the AI's concept per letter, marked AI, and a new call drops it", () => {
    const [quick] = cards;
    const { cards: out, filled } = applyReview(
      cards,
      [quick.id],
      [
        {
          id: quick.id,
          playType: "unknown",
          routes: { ps1: "slant", ps2: "flat", ps3: "curl", bs1: "slant", bs2: "none", back: "protect" },
        },
      ],
    );
    expect(filled).toBe(1);
    expect(out[0].aiHints).toEqual({ routes: true });
    expect(out[0].routeOverrides).toEqual({
      Z: { route: "slant", source: "ai" },
      Y: { route: "flat", source: "ai" },
      H: { route: "curl", source: "ai" },
      X: { route: "slant", source: "ai" },
      F: { route: "protect", source: "ai" },
    });
    const d = buildDiagram(out[0]);
    expect(d.jobs).toMatchObject({ Z: "2 Slant", Y: "Flat", H: "4 Curl", F: "Pass pro" });
    const retyped = updateCard(out[0], { playCall: "SMASH" });
    expect(retyped.routeOverrides).toEqual({});
    expect(retyped.aiHints).toBeUndefined();
  });

  it("ignores a 'concept' that's one route for everyone", () => {
    const [quick] = cards;
    const same = { ps1: "slant", ps2: "slant", ps3: "slant", bs1: "slant" };
    const { cards: out } = applyReview(cards, [quick.id], [{ id: quick.id, routes: same }]);
    expect(out[0].routeOverrides).toBeUndefined();
    expect(out[0].aiReviewed).toBe(true);
  });
});

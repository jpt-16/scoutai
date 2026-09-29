import { describe, expect, it } from "vitest";
import { buildDiagram, playKind } from "./formations";
import { parseHudlCsvText, updateCard } from "./hudlParser";
import { applyReview, buildReviewPrompt, needsReview, reviewRows, sanitizeReviewRow } from "./importReview";

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

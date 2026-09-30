import { describe, expect, it } from "vitest";
import { checklistLabel, needsTextAi, planBatch, sortBatchFiles, textAiRequest } from "./batchMatcher";
import { parseHudlCsvText } from "./hudlParser";

const CSV = [
  "PLAY #,OFF FORM,OFF PLAY,DEF FRONT,COVERAGE",
  "1,TRIO,SLOT RPO BUBBLE,EVEN,Cover 3",
  "3,TRIO,G ISO,,",
  "4,BLACK,BANANA,,", // neither formation nor call is readable
  "7,DUCES,MESH RAIL,ODD,",
].join("\n");
const cards = parseHudlCsvText(CSV).cards;

describe("sortBatchFiles", () => {
  it("finds the clips and the sheet in a Hudl zip, skipping Mac clutter", () => {
    const sorted = sortBatchFiles(
      ["Game/clip_01.mp4", "Game/clip_02.MOV", "Game/breakdown.xlsx", "__MACOSX/Game/._clip_01.mp4", "Game/.DS_Store", "readme.txt"].map(
        (name) => ({ name }),
      ),
    );
    expect(sorted.clips.map((f) => f.name)).toEqual(["Game/clip_01.mp4", "Game/clip_02.MOV"]);
    expect(sorted.sheets.map((f) => f.name)).toEqual(["Game/breakdown.xlsx"]);
    expect(sorted.other.map((f) => f.name)).toEqual(["readme.txt"]);
  });
});

describe("planBatch", () => {
  it("matches clips to PLAY # and routes every row", () => {
    const plan = planBatch(["clip_01.mp4", "play_7.mp4", "clip_99.mp4", "intro.mp4"], cards);
    expect(plan.matchedBy).toBe("play-number");
    expect(plan.rows.map((r) => [r.card.playNumber, r.clip, r.route])).toEqual([
      [1, "clip_01.mp4", "video"],
      [3, null, "sheet"], // TRIO G ISO draws fine from the sheet
      [4, null, "text"], // BLACK BANANA: the text AI draws it
      [7, "play_7.mp4", "video"],
    ]);
    expect(plan.unmatchedClips).toEqual(["clip_99.mp4", "intro.mp4"]);
    expect(plan.counts).toEqual({ video: 2, text: 1, sheet: 1 });
  });

  it("falls back to row order when the clips are numbered 1..N and PLAY # isn't", () => {
    const plan = planBatch(["clip_02.mp4", "clip_03.mp4", "clip_04.mp4"], cards);
    // PLAY # would match only 3 and 4; row order matches all three (rows 2-4).
    expect(plan.matchedBy).toBe("row-order");
    expect(plan.rows.map((r) => r.clip)).toEqual([null, "clip_02.mp4", "clip_03.mp4", "clip_04.mp4"]);
  });

  it("never gives one row two clips", () => {
    const plan = planBatch(["clip_1.mp4", "play_001.mp4"], cards);
    expect(plan.rows[0].clip).toBe("clip_1.mp4");
    expect(plan.unmatchedClips).toEqual(["play_001.mp4"]);
  });
});

describe("rows and labels", () => {
  it("labels checklist rows", () => {
    const plan = planBatch(["Game/clip_01.mp4"], cards);
    expect(checklistLabel(plan.rows[0])).toBe("Play 1: clip_01.mp4 ↔ TRIO · SLOT RPO BUBBLE");
    expect(checklistLabel(plan.rows[1])).toBe("Play 3: TRIO · G ISO");
  });

  it("asks the text AI for the call against the look it was run into", () => {
    expect(textAiRequest(cards[0])).toEqual({ playName: "SLOT RPO BUBBLE", formation: "TRIO", defensiveCall: "EVEN Cover 3" });
    expect(needsTextAi(cards[1])).toBe(false);
    expect(needsTextAi(cards[2])).toBe(true);
  });
});

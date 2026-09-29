import { describe, expect, it } from "vitest";
import { extractPlayNumberFromFileName, matchClipsToCards } from "./clipMatching";
import { parseHudlCsvText } from "./hudlParser";

const CSV = [
  "PLAY #,DN,DIST,OFF FORM,OFF PLAY",
  "1,1,10,SPREAD,SLANT",
  "4,2,7,TRIPS,FADE",
  "12,3,3,I-FORM,POWER",
].join("\n");

describe("extractPlayNumberFromFileName", () => {
  it("reads the first run of digits", () => {
    expect(extractPlayNumberFromFileName("Clip_4.mp4")).toBe(4);
    expect(extractPlayNumberFromFileName("Play_001.mp4")).toBe(1);
    expect(extractPlayNumberFromFileName("12.mov")).toBe(12);
    expect(extractPlayNumberFromFileName("game2_play7.mp4")).toBe(2);
  });

  it("returns null with no digits in the name itself", () => {
    // ".mp4" contains a digit — must not be mistaken for the play number.
    expect(extractPlayNumberFromFileName("clip.mp4")).toBeNull();
    expect(extractPlayNumberFromFileName("clip.mov")).toBeNull();
  });
});

describe("matchClipsToCards", () => {
  it("matches a clip's embedded number to the card with that playNumber", () => {
    const { cards } = parseHudlCsvText(CSV);
    const matches = matchClipsToCards(["Clip_4.mp4", "Play_012.mp4"], cards);
    expect(matches[0]).toMatchObject({ fileName: "Clip_4.mp4", playNumber: 4 });
    expect(matches[0].card?.playCall).toBe("FADE");
    expect(matches[1]).toMatchObject({ fileName: "Play_012.mp4", playNumber: 12 });
    expect(matches[1].card?.playCall).toBe("POWER");
  });

  it("leaves a clip unmatched when its number has no corresponding row", () => {
    const { cards } = parseHudlCsvText(CSV);
    const matches = matchClipsToCards(["Clip_99.mp4"], cards);
    expect(matches[0]).toEqual({ fileName: "Clip_99.mp4", playNumber: 99, card: null });
  });

  it("leaves a clip unmatched when its filename has no number", () => {
    const { cards } = parseHudlCsvText(CSV);
    const matches = matchClipsToCards(["clip.mp4"], cards);
    expect(matches[0]).toEqual({ fileName: "clip.mp4", playNumber: null, card: null });
  });
});

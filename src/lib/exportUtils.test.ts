import { describe, expect, it } from "vitest";
import { EXPORT_TARGETS, exportFileName, fitCard, imageName } from "./exportUtils";

const CARD_ASPECT = 760 / 600;

describe("fitCard", () => {
  it("fills a 4:3 CoachPad page without cropping the card", () => {
    const coachpad = EXPORT_TARGETS.find((t) => t.id === "coachpad")!;
    expect(coachpad.px.w / coachpad.px.h).toBeCloseTo(4 / 3);
    expect(Math.hypot(coachpad.pageIn.w, coachpad.pageIn.h)).toBeCloseTo(13.3, 1);
    const box = fitCard(coachpad.px, CARD_ASPECT);
    // The card is a touch narrower than 4:3, so height is the limit.
    expect(box.h).toBeCloseTo(1200 - 2 * 24);
    expect(box.w / box.h).toBeCloseTo(CARD_ASPECT);
    expect(box.x).toBeGreaterThan(0);
    expect(box.x + box.w).toBeLessThanOrEqual(1600);
    expect(box.y + box.h).toBeLessThanOrEqual(1200);
  });

  it("every target's pixels match its page shape", () => {
    for (const t of EXPORT_TARGETS) expect(t.px.w / t.px.h).toBeCloseTo(t.pageIn.w / t.pageIn.h, 2);
  });

  it("fits a wide card by width", () => {
    const box = fitCard({ w: 1000, h: 1000 }, 2, 0);
    expect(box).toEqual({ x: 0, y: 250, w: 1000, h: 500 });
  });
});

describe("names", () => {
  it("names the file after the script, unit, period and screen", () => {
    expect(exportFileName("Central Catholic v Hendricken.csv", "defense", "team", "coachpad", "pdf")).toBe(
      "central-catholic-v-hendricken-scout-d-team-coachpad.pdf",
    );
    expect(exportFileName("", "offense", "7v7", "ipad", "zip")).toBe("script-scout-o-7v7-ipad.zip");
  });

  it("numbers images so a folder sorts in script order", () => {
    expect(imageName(2, 50, 14, "Trips Rt")).toBe("03-play-14-trips-rt.png");
    expect(imageName(9, 120, 101, "")).toBe("010-play-101.png");
  });
});

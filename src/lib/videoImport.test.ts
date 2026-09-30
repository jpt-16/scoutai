import { describe, expect, it } from "vitest";
import { buildDiagram, hasCoachRoutes } from "./formations";
import { parseHudlCsvText } from "./hudlParser";
import {
  applyDetectionToCard,
  ballFromDetection,
  buildCardFromDetection,
  validateDetectedPlay,
  type DetectedPlay,
} from "./videoImport";

// Deliberately no run/pass/RPO keyword in the play name, so `diagram.kind`
// below can only come from the detected route itself (via `hasCoachRoutes`),
// not from the text-keyword classifier a real Hudl play call would hit too.
const VALID_DETECTION: DetectedPlay = {
  playName: "Detected concept 1",
  formation: "Spread 2x2",
  players: [
    {
      label: "X",
      start: { x: 20, y: 70 },
      waypoints: [],
      endpoint: { x: 35, y: 30 },
      routeType: "SLANT",
    },
    {
      label: "Q",
      start: { x: 50, y: 55 },
      waypoints: [],
      endpoint: { x: 50, y: 55 }, // didn't move: no route to draw
    },
  ],
};

describe("validateDetectedPlay", () => {
  it("accepts a well-formed detection", () => {
    expect(validateDetectedPlay(VALID_DETECTION)).toBeNull();
  });

  it("rejects a non-object, a missing field, and a bad player shape", () => {
    expect(validateDetectedPlay(null)).toMatch(/not an object/);
    expect(validateDetectedPlay({ playName: "x" })).toMatch(/formation/);
    expect(validateDetectedPlay({ playName: "x", formation: "y", players: [] })).toMatch(
      /No players/,
    );
    expect(
      validateDetectedPlay({
        playName: "x",
        formation: "y",
        players: [{ label: "X", start: { x: 1 }, waypoints: [], endpoint: { x: 1, y: 1 } }],
      }),
    ).toMatch(/start point/);
  });
});

describe("buildCardFromDetection", () => {
  it("produces a card that classifies the formation and draws without crashing", () => {
    const card = buildCardFromDetection(VALID_DETECTION, "endzone-clip.mp4", 1);
    expect(card.formationKey).toBe("spread");
    expect(card.source).toBe("endzone-clip.mp4");
    expect(card.routeOverrides?.X?.source).toBe("video");
    expect(card.routeOverrides?.X?.tag).toBe("SLANT");
    expect(card.routeOverrides?.X?.path?.length).toBeGreaterThan(0);
    expect(hasCoachRoutes(card)).toBe(true);

    // Renders through the same pipeline as any other card, and marks the
    // route as video-sourced so ScoutCard knows to draw drag handles on it.
    const diagram = buildDiagram(card, "team", "offense");
    expect(diagram.kind).toBe("pass"); // no run/pass keyword in the play name — only the detected route makes this a pass
    const routeIndex = diagram.routeVideoLetters.indexOf("X");
    expect(routeIndex).toBeGreaterThanOrEqual(0);
    expect(diagram.routes[routeIndex].length).toBeGreaterThan(1);
  });

  it("skips a player whose route never actually moved (no path to draw)", () => {
    const card = buildCardFromDetection(VALID_DETECTION, "clip.mp4", 1);
    // Q's start and endpoint are close enough to collapse to no path.
    expect(card.routeOverrides?.Q).toBeUndefined();
  });

  it("ignores a player label outside this app's convention rather than guessing", () => {
    const detection: DetectedPlay = {
      ...VALID_DETECTION,
      players: [
        ...VALID_DETECTION.players,
        { label: "RB", start: { x: 10, y: 10 }, waypoints: [], endpoint: { x: 90, y: 90 } },
      ],
    };
    const card = buildCardFromDetection(detection, "clip.mp4", 1);
    expect(card.routeOverrides?.RB).toBeUndefined();
  });
});

describe("the QB anchor: who got the ball and where", () => {
  const withBall: DetectedPlay = { ...VALID_DETECTION, playType: "pass", ballCarrier: "X", ballDirection: "left" };

  it("reads the ball off the film for a single clip", () => {
    const card = buildCardFromDetection(withBall, "clip.mp4");
    expect(card.playDir).toBe("L");
    expect(card.playDirection).toBe("left");
    expect(card.playType).toBe("Pass");
    expect(card.notes).toBe("Ball: X, left (from film)");
    // The carrier's arrow is marked BALL.
    expect(card.routeOverrides?.X?.tag).toBe("BALL");
  });

  it("ignores a carrier that isn't one of the staff's letters, and leaves a run's type blank", () => {
    const card = buildCardFromDetection({ ...withBall, playType: "run", ballCarrier: "RB", ballDirection: "unknown" }, "c");
    expect(card.playType).toBe("");
    expect(card.playDir).toBe("");
    expect(card.notes).toBe("");
    expect(card.routeOverrides?.X?.tag).toBe("SLANT");
  });

  it("never overrides what the CSV says; only fills blanks", () => {
    const csv = parseHudlCsvText("PLAY #,OFF FORM,OFF PLAY,PLAY DIR\n1,SPREAD,MESH,R\n2,SPREAD,MESH,\n").cards;
    const tagged = applyDetectionToCard(csv[0], withBall);
    expect(tagged.playDir).toBe("R");
    expect(tagged.notes).toBe("Ball: X, left (from film)");
    const blank = applyDetectionToCard(csv[1], withBall);
    expect(blank.playDir).toBe("L");
    expect(ballFromDetection({ ...withBall, ballCarrier: "none", ballDirection: "middle" }).note).toBe(
      "Ball: middle (from film)",
    );
  });
});

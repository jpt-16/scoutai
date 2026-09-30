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

describe("film read in field yards (a sideline Hudl recording, Trio Slot RPO Bubble)", () => {
  // What the film prompt asks for on the user's test clip: positions in yards from the ball,
  // Hudl's data bar copied, and letters the model got wrong on purpose (it called the lone
  // receiver Z and the widest trips receiver X).
  const detection: DetectedPlay = {
    playName: "Bubble screen",
    formation: "Trips",
    camera: "sideline",
    units: "yards",
    hudl: { playNumber: "5", formation: "Trio SLOT", playCall: "RPO BUBBLE", playType: "Pass", hash: "R", offStrength: "L", playDir: "L" },
    playType: "pass",
    ballCarrier: "H",
    ballDirection: "left",
    players: [
      { label: "Q", start: { x: 0, y: -5 }, waypoints: [], endpoint: { x: 0, y: -6 } },
      { label: "Z", start: { x: 22, y: -1 }, waypoints: [], endpoint: { x: 22, y: 3 } }, // lone WR, offense's right: stalk
      { label: "H", start: { x: -9, y: -1 }, waypoints: [{ x: -12, y: -2 }], endpoint: { x: -18, y: 1 } }, // bubble
      { label: "Y", start: { x: -16, y: -1 }, waypoints: [], endpoint: { x: -17, y: 3 } }, // blocks
      { label: "X", start: { x: -23, y: -1 }, waypoints: [], endpoint: { x: -23, y: 4 } }, // blocks
    ],
  };
  const card = buildCardFromDetection(detection, "test_2.mp4");

  it("takes the coach's own tags from Hudl's data bar", () => {
    expect(card).toMatchObject({
      playNumber: 5,
      formation: "Trio SLOT",
      playCall: "RPO BUBBLE",
      hash: "R",
      formationKey: "trips",
      formationSide: "left",
      playDirection: "left",
    });
  });

  it("puts each route on the player who actually lined up there, whatever the model called him", () => {
    const o = card.routeOverrides!;
    // The lone receiver (the card's X) goes straight upfield 4 yards: 4 × 7 px, nothing across.
    expect(o.X.path).toEqual([[0, -4 * 7]]);
    // The inside trips receiver (H) is the bubble: out to the left and back first, marked BALL.
    expect(o.H.tag).toBe("BALL");
    const [first] = o.H.path!;
    expect(first[0]).toBeLessThan(0); // toward the offense's left
    expect(first[1]).toBeGreaterThan(0); // behind the line
    // The widest trips receiver (the card's Z) got the route the model labeled X.
    expect(o.Z.path).toEqual([[0, -5 * 7]]);
  });

  it("is scale-true, so a sideline angle doesn't turn routes sideways", () => {
    const d = buildDiagram(card, "team", "offense");
    const x = d.players.find((p) => p.label === "X")!;
    const xRoute = d.routes[d.routeVideoLetters.indexOf("X")];
    expect(xRoute[xRoute.length - 1].x).toBeCloseTo(x.x, 0);
    expect(x.y - xRoute[xRoute.length - 1].y).toBeCloseTo(4 * 7, 0);
  });

  it("still reads an old frame-percent answer the old way", () => {
    expect(buildCardFromDetection(VALID_DETECTION, "old").routeOverrides?.X?.path?.length).toBeGreaterThan(0);
  });
});

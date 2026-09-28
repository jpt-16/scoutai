import { describe, expect, it } from "vitest";
import {
  detectedRouteToPathDeltas,
  percentToCard,
  simplifyPath,
  type CardPoint,
} from "./coordinateMapper";

const BOUNDS = { width: 500, height: 300 };

describe("percentToCard", () => {
  it("stretches 0-100 percentages onto the card's own dimensions", () => {
    expect(percentToCard({ x: 0, y: 0 }, BOUNDS)).toEqual({ x: 0, y: 0 });
    expect(percentToCard({ x: 100, y: 100 }, BOUNDS)).toEqual({ x: 500, y: 300 });
    expect(percentToCard({ x: 50, y: 50 }, BOUNDS)).toEqual({ x: 250, y: 150 });
  });
});

describe("simplifyPath", () => {
  it("leaves a straight line as just its endpoints", () => {
    const points: CardPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 },
    ];
    expect(simplifyPath(points, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 30 },
    ]);
  });

  it("keeps a real corner beyond the tolerance", () => {
    // A stem straight up, then a sharp break to the right (an "out" shape).
    const points: CardPoint[] = [
      { x: 0, y: 0 },
      { x: 0, y: -20 },
      { x: 0, y: -40 },
      { x: 15, y: -40 },
      { x: 30, y: -40 },
    ];
    const simplified = simplifyPath(points, 2);
    expect(simplified).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: -40 },
      { x: 30, y: -40 },
    ]);
  });

  it("collapses jitter within tolerance around an otherwise-straight line", () => {
    const points: CardPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0.5 },
      { x: 20, y: -0.5 },
      { x: 30, y: 0 },
    ];
    expect(simplifyPath(points, 2)).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it("returns short inputs unchanged", () => {
    expect(simplifyPath([], 1)).toEqual([]);
    expect(simplifyPath([{ x: 1, y: 2 }], 1)).toEqual([{ x: 1, y: 2 }]);
  });
});

describe("detectedRouteToPathDeltas", () => {
  it("returns deltas from the start point, dropping a waypoint that's on the straight line", () => {
    const deltas = detectedRouteToPathDeltas(
      {
        start: { x: 10, y: 80 },
        waypoints: [{ x: 20, y: 80 }], // sits exactly between start and endpoint: not a real break
        endpoint: { x: 30, y: 80 },
      },
      BOUNDS,
      2,
    );
    // All three points share the same y, so the middle one collapses out,
    // leaving a single delta straight to the endpoint.
    expect(deltas).toEqual([[100, 0]]);
  });

  it("keeps a real break in a detected route (start -> stem -> cut)", () => {
    const deltas = detectedRouteToPathDeltas(
      {
        start: { x: 10, y: 80 }, // card (50, 240)
        waypoints: [{ x: 10, y: 60 }], // card (50, 180): straight up the stem
        endpoint: { x: 30, y: 60 }, // card (150, 180): a hard break to the sideline
      },
      BOUNDS,
      2,
    );
    expect(deltas).toEqual([
      [0, -60],
      [100, -60],
    ]);
  });

  it("returns an empty array when the route never actually moves", () => {
    const deltas = detectedRouteToPathDeltas(
      { start: { x: 10, y: 80 }, waypoints: [], endpoint: { x: 10, y: 80 } },
      BOUNDS,
    );
    expect(deltas).toEqual([]);
  });
});

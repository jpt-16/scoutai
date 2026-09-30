/**
 * Turns a video-detected player route (a vision model's own normalized 0–100
 * frame-percentage points) into the delta-waypoint shape `RouteOverride.path`
 * expects: a start point plus a short, clean list of straight segments,
 * relative to the player's own position.
 *
 * This is deliberately NOT a calibrated top-down transform — there's no
 * homography or real-world calibration here (that's what the separate
 * `video-service/` Python service does with actual clicked calibration
 * points). It's the vision model's own spatial guess from an oblique camera
 * angle, linearly stretched onto the card's field canvas. Treat it as a
 * starting point a coach drags to correct, never as a measurement.
 *
 * Framework-free (no React, no fetch) so it's directly unit-testable.
 */

/** A point in percent-of-frame units, 0–100 on each axis, as the vision model returns them. */
export interface PercentPoint {
  x: number;
  y: number;
}

/** A point in the card's own SVG units (viewBox 500 × 300 — see `formations.ts`'s `FIELD`). */
export interface CardPoint {
  x: number;
  y: number;
}

/** The card's coordinate space, passed in rather than imported to keep this file dependency-free. */
export interface CardBounds {
  width: number;
  height: number;
}

/**
 * Linearly stretches a 0–100 frame-percentage point onto the card canvas.
 * Not a perspective correction — see the file doc comment.
 */
export function percentToCard(p: PercentPoint, bounds: CardBounds): CardPoint {
  return { x: (p.x / 100) * bounds.width, y: (p.y / 100) * bounds.height };
}

/** Perpendicular distance from point `p` to the line through `a` and `b`. */
function distanceToSegment(p: CardPoint, a: CardPoint, b: CardPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // How far along the a->b line p's projection falls, clamped onto the segment.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * Ramer–Douglas–Peucker: collapses a noisy polyline down to the points where
 * its direction actually changes, within `tolerance` card units. This is how
 * a wobbly AI-tracked path becomes the app's usual clean "stem, then a sharp
 * break" route shape instead of a literal curve (see `CLAUDE.md`).
 */
export function simplifyPath(points: CardPoint[], tolerance: number): CardPoint[] {
  if (points.length <= 2) return points;

  let maxDistance = 0;
  let splitIndex = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i], first, last);
    if (d > maxDistance) {
      maxDistance = d;
      splitIndex = i;
    }
  }

  if (maxDistance <= tolerance) return [first, last];

  const left = simplifyPath(points.slice(0, splitIndex + 1), tolerance);
  const right = simplifyPath(points.slice(splitIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

/** One player's detected route, in the shape the vision model returns it. */
export interface DetectedPlayerRoute {
  start: PercentPoint;
  waypoints: PercentPoint[];
  endpoint: PercentPoint;
}

/** Card units to simplify within — small enough to keep real breaks, big enough to drop jitter. */
const DEFAULT_SIMPLIFY_TOLERANCE = 6;

/**
 * Converts one detected route into `RouteOverride.path`'s shape: waypoint
 * deltas relative to the player's own (start) position, simplified down to
 * a few straight segments. Returns `[]` when the route collapses to just
 * the start point (nothing to draw).
 */
export function detectedRouteToPathDeltas(
  route: DetectedPlayerRoute,
  bounds: CardBounds,
  tolerance: number = DEFAULT_SIMPLIFY_TOLERANCE,
): [number, number][] {
  const absolute = [route.start, ...route.waypoints, route.endpoint].map((p) =>
    percentToCard(p, bounds),
  );
  const simplified = simplifyPath(absolute, tolerance);
  const start = simplified[0];
  const rest = simplified.slice(1);
  // The whole path collapsed onto (or near) the start point — nothing to draw.
  if (rest.every((p) => Math.hypot(p.x - start.x, p.y - start.y) < 1)) return [];
  return rest.map((p) => [p.x - start.x, p.y - start.y]);
}

/**
 * Film routes in field yards (the vision model's answer since it measures off
 * the yard lines instead of the screen): `x` = yards to the offense's right
 * (+) or left (−), `y` = yards past the line of scrimmage (+) or into the
 * backfield (−). Unlike frame percentages this doesn't depend on where the
 * camera stood or whether it panned: a sideline camera's "across the screen"
 * and an end-zone camera's "up the screen" both come back as downfield yards.
 */
export interface YardScale {
  /** Card units per yard across the field. */
  across: number;
  /** Card units per yard downfield. */
  downfield: number;
}

/** Yards to card units, offense view: downfield is up (smaller y). Absurd values are clamped to the field. */
export function yardsToCard(p: PercentPoint, scale: YardScale): CardPoint {
  const across = Math.max(-30, Math.min(30, p.x));
  const downfield = Math.max(-20, Math.min(60, p.y));
  return { x: across * scale.across, y: -downfield * scale.downfield };
}

/** Like `detectedRouteToPathDeltas`, for a route measured in field yards. */
export function yardRouteToPathDeltas(
  route: DetectedPlayerRoute,
  scale: YardScale,
  tolerance: number = DEFAULT_SIMPLIFY_TOLERANCE,
): [number, number][] {
  const absolute = [route.start, ...route.waypoints, route.endpoint].map((p) => yardsToCard(p, scale));
  const simplified = simplifyPath(absolute, tolerance);
  const start = simplified[0];
  const rest = simplified.slice(1);
  if (rest.every((p) => Math.hypot(p.x - start.x, p.y - start.y) < 1)) return [];
  return rest.map((p) => [p.x - start.x, p.y - start.y]);
}

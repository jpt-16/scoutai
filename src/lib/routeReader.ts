/**
 * Reads a receiver's path as one of the staff's routes (the route tree 0-9 plus GO,
 * HITCH, DIG, WHEEL, FLAT, SWING, WHIP, BUBBLE, LEAK). This is the step Hudl Assist
 * gets wrong: given where a player actually went, which route was it?
 *
 * The input is a path in yards, wherever it came from (a tracker on film, an AI read,
 * a coach's drawn arrow), so the same reader serves them all and can be checked on its
 * own. It's matched against the app's own route shapes (`routeTemplateYards`), so a
 * label here is exactly the route the card would draw for it, with a measured distance
 * and a runner-up, so a coach is only asked to look at the plays it isn't sure about.
 *
 * Players don't run a diagram: stems vary a couple of yards, breaks round off, and the
 * path runs on after the catch. So templates are compared over the same stretch of path
 * (the observed route, not the run after it), with a little tolerance on depth and width.
 */

import { routeTemplateYards, type RouteKind } from "./formations";

export interface RoutePoint {
  x: number;
  y: number;
}

/** Every route the reader can name. */
export const READABLE_ROUTES: RouteKind[] = [
  "slide", "speed-out", "slant", "out", "curl", "comeback", "shallow", "corner", "post", "fade",
  "go", "hitch", "dig", "wheel", "flat", "swing", "whip", "bubble", "leak",
];

export interface RouteRead {
  /** The route, "block" if he barely left his spot, or "unknown" if nothing fits. */
  kind: RouteKind | "block" | "unknown";
  /** Mean yards between his path and that route's shape (lower is closer). */
  distance: number;
  /** 0-1: how far ahead of the runner-up. Low means "have a coach look". */
  confidence: number;
  /** Every route, closest first. */
  ranked: { kind: RouteKind; distance: number }[];
}

/** A path this far from every shape (yards, mean) isn't any of them. */
export const UNKNOWN_DISTANCE = 4.5;
/** A player who stays within this many yards of his spot (and goes nowhere) is blocking. */
const BLOCK_YARDS = 2.5;
const SAMPLES = 24;
/** How much the single biggest gap counts against a shape, against the average gap. */
const WORST_WEIGHT = 0.4;
/** Yards of benefit of the doubt per turn in a route, so the simpler of two close routes wins. */
const SIMPLICITY = 0.25;
/** How much deeper / wider than the diagram a real route may run. */
const SCALES = [0.8, 0.9, 1, 1.12, 1.25];

function lengthOf(pts: RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return total;
}

/** `n` points evenly along the first `upTo` yards of the path. */
function resample(pts: RoutePoint[], n: number, upTo: number): RoutePoint[] {
  const out: RoutePoint[] = [];
  let seg = 1;
  let walked = 0;
  for (let k = 0; k < n; k++) {
    const target = (upTo * k) / (n - 1);
    while (seg < pts.length - 1 && walked + Math.hypot(pts[seg].x - pts[seg - 1].x, pts[seg].y - pts[seg - 1].y) < target) {
      walked += Math.hypot(pts[seg].x - pts[seg - 1].x, pts[seg].y - pts[seg - 1].y);
      seg += 1;
    }
    const a = pts[seg - 1];
    const b = pts[Math.min(seg, pts.length - 1)];
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    const t = span > 0 ? Math.min(1, Math.max(0, (target - walked) / span)) : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** How far a route's last leg is carried on, for the run after the catch. */
const CARRY_ON_YARDS = 14;

const templates = new Map<RouteKind, RoutePoint[]>();
function template(kind: RouteKind): RoutePoint[] {
  let t = templates.get(kind);
  if (!t) {
    t = routeTemplateYards(kind, 1).map(([x, y]) => ({ x, y }));
    templates.set(kind, t);
  }
  return t;
}

/** The shape scaled, then carried straight on past its end: what a player does after the catch. */
function extended(shape: RoutePoint[]): RoutePoint[] {
  const b = shape[shape.length - 1];
  // The direction of the last leg that actually moves.
  for (let i = shape.length - 2; i >= 0; i--) {
    const len = Math.hypot(b.x - shape[i].x, b.y - shape[i].y);
    if (len > 0.5) {
      return [...shape, { x: b.x + ((b.x - shape[i].x) / len) * CARRY_ON_YARDS, y: b.y + ((b.y - shape[i].y) / len) * CARRY_ON_YARDS }];
    }
  }
  return shape;
}

/** A light 3-point average, so tracker jitter doesn't read as a break. */
function smooth(pts: RoutePoint[]): RoutePoint[] {
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    return { x: (pts[i - 1].x + p.x + pts[i + 1].x) / 3, y: (pts[i - 1].y + p.y + pts[i + 1].y) / 3 };
  });
}

/**
 * @param track  The player's path in yards: x toward the offense's right, y upfield, any origin.
 * @param outside  Which way his sideline is: +1 if he lines up right of the ball, -1 if left.
 */
export function readRoute(track: RoutePoint[], outside: 1 | -1 = 1): RouteRead {
  const none: RouteRead = { kind: "unknown", distance: Infinity, confidence: 0, ranked: [] };
  if (track.length < 3) return none;
  // From his own spot, mirrored so his sideline is +x like the shapes.
  const start = track[0];
  const path = smooth(track.map((p) => ({ x: (p.x - start.x) * outside, y: p.y - start.y })));
  const total = lengthOf(path);
  const net = Math.hypot(path[path.length - 1].x, path[path.length - 1].y);
  if (total < BLOCK_YARDS || (net < BLOCK_YARDS && total < BLOCK_YARDS * 2)) {
    return { kind: "block", distance: 0, confidence: 1, ranked: [] };
  }

  const ranked = READABLE_ROUTES.map((kind) => {
    let best = Infinity;
    for (const sx of SCALES) {
      for (const sy of SCALES) {
        const shape = template(kind).map((p) => ({ x: p.x * sx, y: p.y * sy }));
        const want = lengthOf(shape);
        // The whole path seen, against the shape carried on past its end (the run after the
        // catch), so a short route can't pass for a long one just because they start alike.
        const model0 = extended(shape);
        const upTo = Math.min(total, lengthOf(model0));
        const seen = resample(path, SAMPLES, upTo);
        const model = resample(model0, SAMPLES, upTo);
        let sum = 0;
        let worst = 0;
        for (let i = 0; i < SAMPLES; i++) {
          const gap = Math.hypot(seen[i].x - model[i].x, seen[i].y - model[i].y);
          sum += gap;
          worst = Math.max(worst, gap);
        }
        // A path that stops short of the route's length hasn't shown the whole route.
        const shortfall = Math.max(0, want * 0.8 - total);
        // The average alone lets a go pass for a comeback (they match for sixteen yards);
        // the worst gap is where they part.
        // When a plain route and a fancier one both explain the path, call the plain one: a
        // straight path that never turns back is a go, not a comeback not yet seen.
        const breaks = Math.max(0, shape.length - 2);
        const dist = (sum / SAMPLES) * (1 - WORST_WEIGHT) + worst * WORST_WEIGHT + shortfall * 0.5 + breaks * SIMPLICITY;
        if (dist < best) best = dist;
      }
    }
    return { kind, distance: best };
  }).sort((a, b) => a.distance - b.distance);

  const [first, second] = ranked;
  if (first.distance > UNKNOWN_DISTANCE) return { kind: "unknown", distance: first.distance, confidence: 0, ranked };
  return {
    kind: first.kind,
    distance: first.distance,
    confidence: Math.min(1, Math.max(0, (second.distance - first.distance) / Math.max(second.distance, 0.5))),
    ranked,
  };
}

import { describe, expect, it } from "vitest";
import { routeTemplateYards, type RouteKind } from "./formations";
import { READABLE_ROUTES, readRoute, type RoutePoint } from "./routeReader";

/** A small seeded random source, so the "players" are the same every run. */
function rng(seed: number) {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  return { next, normal, between: (lo: number, hi: number) => lo + (hi - lo) * next() };
}

/** Round the corners the way a runner does (one pass of Chaikin cutting). */
function round(pts: RoutePoint[]): RoutePoint[] {
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * A route as a player runs it, not as it's diagrammed: stems and breaks a couple of yards off,
 * corners rounded, a different speed, tracker noise on every point, and sometimes the run
 * after the catch. `outside` puts him on the left or right of the ball.
 */
function played(kind: RouteKind, r: ReturnType<typeof rng>, outside: 1 | -1): RoutePoint[] {
  const shape = routeTemplateYards(kind, 1);
  const sx = r.between(0.85, 1.15);
  const sy = r.between(0.85, 1.15);
  const vertices: RoutePoint[] = shape.map(([x, y], i) =>
    i === 0 ? { x: 0, y: 0 } : { x: x * sx + r.normal() * 0.8, y: y * sy + r.normal() * 0.9 },
  );
  if (r.next() < 0.4) {
    // Runs on after the catch, in the direction of the last leg.
    const a = vertices[vertices.length - 2];
    const b = vertices[vertices.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    vertices.push({ x: b.x + ((b.x - a.x) / len) * 4, y: b.y + ((b.y - a.y) / len) * 4 });
  }
  const line = round(vertices);
  // Sample every ~0.4 yd, with noise, and put him on his side of the ball.
  const pts: RoutePoint[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [a, b] = [line[i], line[i + 1]];
    const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 0.4));
    for (let k = 0; k < steps; k++) {
      pts.push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps });
    }
  }
  return pts.map((p, i) => ({
    x: (i === 0 ? p.x : p.x + r.normal() * 0.3) * outside + 12 * outside,
    y: i === 0 ? p.y : p.y + r.normal() * 0.3,
  }));
}

describe("readRoute", () => {
  it("reads every route exactly as the staff draws it, on either side of the ball", () => {
    for (const kind of READABLE_ROUTES) {
      for (const outside of [1, -1] as const) {
        const track = routeTemplateYards(kind, 1).map(([x, y]) => ({ x: x * outside, y }));
        // A dense walk along the diagram.
        const dense: RoutePoint[] = [];
        for (let i = 0; i < track.length - 1; i++) {
          for (let k = 0; k < 10; k++) {
            const t = k / 10;
            dense.push({ x: track[i].x + (track[i + 1].x - track[i].x) * t, y: track[i].y + (track[i + 1].y - track[i].y) * t });
          }
        }
        dense.push(track[track.length - 1]);
        expect(readRoute(dense, outside).kind, `${kind} on ${outside}`).toBe(kind);
      }
    }
  });

  it("says block for a player who stays at his spot", () => {
    const stay = Array.from({ length: 12 }, (_, i) => ({ x: 20 + Math.sin(i) * 0.3, y: 0.2 * i * 0.1 }));
    expect(readRoute(stay, 1).kind).toBe("block");
  });

  it("says unknown for a path that is no route (a scramble back toward the line)", () => {
    const wander = Array.from({ length: 30 }, (_, i) => ({ x: Math.sin(i / 2) * 9, y: 8 - i * 0.5 }));
    expect(readRoute(wander, 1).kind).toBe("unknown");
  });

  it("reads routes as players run them (rounded, off by a couple of yards, noisy, run on past the catch)", () => {
    const r = rng(1618);
    const tree: RouteKind[] = ["slide", "speed-out", "slant", "out", "curl", "comeback", "shallow", "corner", "post", "fade"];
    const perKind = new Map<RouteKind, { right: number; total: number; mixed: Map<string, number> }>();
    let right = 0;
    let total = 0;
    for (const kind of tree) {
      const tally = { right: 0, total: 0, mixed: new Map<string, number>() };
      for (let i = 0; i < 60; i++) {
        const outside = r.next() < 0.5 ? 1 : -1;
        const read = readRoute(played(kind, r, outside), outside);
        tally.total += 1;
        if (read.kind === kind) tally.right += 1;
        else tally.mixed.set(read.kind, (tally.mixed.get(read.kind) ?? 0) + 1);
      }
      perKind.set(kind, tally);
      right += tally.right;
      total += tally.total;
    }
    const report = [...perKind].map(([k, t]) => `${k} ${t.right}/${t.total} ${[...t.mixed].map(([m, n]) => `${m}×${n}`).join(" ")}`);
    console.log(`route tree, played: ${right}/${total}\n${report.join("\n")}`);
    expect(right / total).toBeGreaterThan(0.8);
    for (const [k, t] of perKind) expect(t.right / t.total, k).toBeGreaterThan(0.6);
  });

  it("is sure of a clear route and unsure when the path stops before the route does", () => {
    // Straight up the field for 22 yards: a go, and clearly.
    const long = Array.from({ length: 56 }, (_, i) => ({ x: 12 + i * 0.002, y: i * 0.4 }));
    const clear = readRoute(long, 1);
    expect(clear.kind).toBe("go");
    expect(clear.confidence).toBeGreaterThan(0.2);
    expect(clear.ranked).toHaveLength(READABLE_ROUTES.length);
    // The same player seen for only 11 yards could still turn into a curl or a comeback: ask a coach.
    const short = readRoute(long.slice(0, 28), 1);
    console.log(`confidence: 22 yards ${clear.confidence.toFixed(2)}, 11 yards ${short.confidence.toFixed(2)} (${short.ranked.slice(0, 3).map((x) => x.kind).join(", ")})`);
    expect(short.confidence).toBeLessThan(clear.confidence);
  });

  it("reads the routes off the tree as played too", () => {
    const r = rng(99);
    const off: RouteKind[] = ["go", "hitch", "dig", "wheel", "flat", "swing", "whip", "bubble", "leak"];
    let right = 0;
    let total = 0;
    const report: string[] = [];
    for (const kind of off) {
      let ok = 0;
      const mixed = new Map<string, number>();
      for (let i = 0; i < 60; i++) {
        const outside = r.next() < 0.5 ? 1 : -1;
        const read = readRoute(played(kind, r, outside), outside);
        if (read.kind === kind) ok += 1;
        else mixed.set(read.kind, (mixed.get(read.kind) ?? 0) + 1);
      }
      right += ok;
      total += 60;
      report.push(`${kind} ${ok}/60 ${[...mixed].map(([m, n]) => `${m}×${n}`).join(" ")}`);
    }
    console.log(`off the tree, played: ${right}/${total}\n${report.join("\n")}`);
    expect(right / total).toBeGreaterThan(0.7);
  });
});


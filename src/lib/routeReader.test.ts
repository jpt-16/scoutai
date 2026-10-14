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
function played(kind: RouteKind, r: ReturnType<typeof rng>, outside: 1 | -1, sloppy = false): RoutePoint[] {
  const shape = routeTemplateYards(kind, 1);
  // Sloppy: a receiver who runs it short or long, releases off the ball sideways, and breaks where he breaks.
  const [lo, hi] = sloppy ? [0.72, 1.3] : [0.85, 1.15];
  const sx = r.between(lo, hi);
  const sy = r.between(lo, hi);
  const [jx, jy] = sloppy ? [1.1, 1.3] : [0.8, 0.9];
  const drift = sloppy ? r.normal() * 1.5 : 0;
  const vertices: RoutePoint[] = shape.map(([x, y], i) =>
    i === 0 ? { x: 0, y: 0 } : { x: x * sx + r.normal() * jx + (i === 1 ? drift : 0), y: y * sy + r.normal() * jy },
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
  }, 60_000);

  it("names the closest route for a route run badly (short or long, a different release), never giving up on it", () => {
    const r = rng(2024);
    const tree: RouteKind[] = ["slide", "speed-out", "slant", "out", "curl", "comeback", "shallow", "corner", "post", "fade"];
    let right = 0;
    let total = 0;
    let unknown = 0;
    for (const kind of tree) {
      for (let i = 0; i < 30; i++) {
        const outside = r.next() < 0.5 ? 1 : -1;
        const read = readRoute(played(kind, r, outside, true), outside);
        total += 1;
        if (read.kind === kind) right += 1;
        if (read.kind === "unknown") unknown += 1;
      }
    }
    console.log(`sloppy routes: ${right}/${total}, unknown ${unknown}`);
    expect(unknown).toBe(0);
    expect(right / total).toBeGreaterThan(0.6);
  }, 60_000);

  it("is sure of a clear route and unsure when the path stops before the route does", () => {
    // Straight up the field for 22 yards: a go, which this staff calls a fade, and clearly.
    const long = Array.from({ length: 56 }, (_, i) => ({ x: 12 + i * 0.002, y: i * 0.4 }));
    const clear = readRoute(long, 1);
    expect(clear.kind).toBe("fade");
    expect(clear.confidence).toBeGreaterThan(0.2);
    expect(clear.ranked).toHaveLength(READABLE_ROUTES.length);
    // The same player seen for only 11 yards could still turn into a curl or a comeback: ask a coach.
    const short = readRoute(long.slice(0, 28), 1);
    console.log(`confidence: 22 yards ${clear.confidence.toFixed(2)}, 11 yards ${short.confidence.toFixed(2)} (${short.ranked.slice(0, 3).map((x) => x.kind).join(", ")})`);
    expect(short.confidence).toBeLessThan(clear.confidence);
  });

  it("a go and a fade are the same route: a straight vertical and a drifting one both read fade", () => {
    const r = rng(7);
    let fade = 0;
    for (let i = 0; i < 40; i++) {
      const outside = r.next() < 0.5 ? 1 : -1;
      const drift = i % 2 ? 0 : 0.08; // a go (straight) or a fade (drifting to the sideline)
      const path = Array.from({ length: 50 }, (_, k) => ({
        x: (12 + k * 0.4 * drift + r.normal() * 0.25) * outside,
        y: k * 0.4 + r.normal() * 0.25,
      }));
      if (readRoute(path, outside).kind === "fade") fade += 1;
    }
    expect(fade / 40).toBeGreaterThan(0.9);
    expect(READABLE_ROUTES).not.toContain("go");
  });

  it("reads the routes off the tree as played too", () => {
    const r = rng(99);
    const off: RouteKind[] = ["hitch", "dig", "wheel", "flat", "swing", "whip", "bubble", "leak"];
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
  }, 60_000);
});

describe("a dig's depth varies", () => {
  const dig = (depth: number) => {
    const p = [];
    for (let i = 0; i <= 10; i++) p.push({ x: 0, y: (depth * i) / 10 });
    for (let i = 1; i <= 12; i++) p.push({ x: -i, y: depth });
    return p;
  };
  it("reads a 12 and a 15 yard dig as a dig", () => {
    expect(readRoute(dig(12), 1).kind).toBe("dig");
    expect(readRoute(dig(15), 1).kind).toBe("dig");
  });
  it("never reads a 7 yard dig as a sure shallow: either the dig, or unsure with the dig next", () => {
    const r = readRoute(dig(7), 1);
    expect(r.kind === "dig" || (r.ranked[1].kind === "dig" && r.confidence < 0.25)).toBe(true);
  });
});

describe("this staff's routes from real play 34", () => {
  const line = (pts: [number, number][], step = 0.5) => {
    const out: RoutePoint[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let k = 0; k < n; k++) out.push({ x: a[0] + ((b[0] - a[0]) * k) / n, y: a[1] + ((b[1] - a[1]) * k) / n });
    }
    const last = pts[pts.length - 1];
    out.push({ x: last[0], y: last[1] });
    return out;
  };

  it("reads a back's speed out (from 5 deep, angled out to the flat two yards past the line) as a speed out", () => {
    const back = line([[0, -5], [-10, 2], [-14, 2.5]]);
    expect(readRoute(back, -1, 5).kind).toBe("speed-out");
  });

  it("draws a back's speed out the same way: out at an angle to two yards past the line, not a straight stem", () => {
    const shape = routeTemplateYards("speed-out", 1, 5);
    expect(shape[1][0]).toBeGreaterThan(8); // the first leg already goes 10 yards out
    expect(shape[1][1]).toBeCloseTo(7, 0); // from 5 deep to 2 past the line
    const receiver = routeTemplateYards("speed-out", 1);
    expect(receiver[1][0]).toBeCloseTo(0, 1); // a receiver's still stems straight up
  });

  it("never calls a route that keeps climbing across a dig (Z: up 4, then in to 10 deep is a slant / skinny post)", () => {
    // Play 34's Z (#15), as tracked on the film (yards from the ball, the 3 s after the snap); he lines up right of the ball.
    const z = ([[11.6, 1.0], [12.0, 0.7], [12.3, 0.6], [12.6, 0.4], [12.6, 0.4], [12.5, 0.6], [12.5, 0.8], [12.7, 0.8], [12.9, 0.8], [12.9, 0.8], [12.9, 1.0], [12.5, 1.4], [12.5, 1.5], [12.9, 1.2], [12.6, 1.6], [12.6, 1.7], [12.6, 1.8], [12.6, 1.9], [12.4, 2.2], [11.9, 2.8], [12.2, 2.6], [12.2, 2.7], [12.3, 2.6], [12.1, 3.0], [11.9, 3.3], [11.2, 4.2], [11.7, 3.9], [11.9, 3.7], [12.0, 3.8], [12.1, 3.8], [12.2, 3.6], [12.2, 3.7], [12.3, 3.6], [12.0, 3.9], [11.6, 4.5], [11.5, 4.7], [11.5, 4.8], [11.5, 4.8], [11.6, 4.8], [11.4, 5.1], [11.1, 5.4], [10.9, 5.5], [10.5, 6.0], [10.6, 5.8], [10.9, 5.5], [10.6, 5.6], [10.1, 6.2], [9.5, 6.7], [9.6, 6.6], [9.8, 6.4], [9.8, 6.4], [9.8, 6.3], [9.5, 6.6], [9.1, 6.9], [8.7, 7.2], [8.0, 7.9], [8.1, 7.7], [7.4, 8.2], [7.2, 8.3], [5.6, 9.0], [4.9, 9.5], [4.5, 9.8], [4.1, 10.1], [4.1, 9.9], [3.7, 10.1], [3.8, 9.7], [3.6, 9.5], [3.5, 9.5]] as [number, number][]).map(([x, y]) => ({ x, y }));
    const r = readRoute(z, 1);
    expect(["slant", "post"]).toContain(r.kind);
  });

  it("still reads a flat 7 yard dig, and a shallow, the way it did", () => {
    const dig = line([[0, 0], [-0.5, 5], [-1.5, 6.2], [-9.5, 6.9]]);
    expect(readRoute(dig, 1).ranked.slice(0, 2).map((x) => x.kind)).toContain("dig");
    const shallow = line([[0, 0], [0, 5], [-14, 5.5]]);
    expect(readRoute(shallow, 1).kind).toBe("shallow");
  });
});

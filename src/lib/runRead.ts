/**
 * Run plays from film: whether the play was a run or a pass, who carried it, which way, and the blocking
 * scheme the staff would call it (power, counter, iso, inside / outside zone, toss, jet, draw, sneak), read
 * from where everyone went after the snap. A card built from film with no sheet behind it gets a play call
 * the card draws ("POWER RT"); with a sheet, the sheet's call stays and `scripts/score-routes.ts` scores
 * the read against it.
 *
 * Plain rules, thresholds at the top, so a wrong answer can be traced to the one that tripped:
 *   - the line fires forward on a run and sets back on a pass, and receivers release deep on a pass;
 *   - the carrier is the back, quarterback or receiver who crosses the line first;
 *   - a lineman who slides 2+ yards along the line in the first second is pulling: one puller toward the play
 *     is power, two is counter; a line that steps together one way is zone; a carrier who gets wide before
 *     turning up is toss (or outside zone, slower); a receiver carrying it across is jet.
 */

import type { RunScheme } from "./formations";
import { deriveCard, type HudlPlayCard } from "./hudlParser";
import { snapTime, type TrackedPlayer, type TrackedPlayFile } from "./trackedPlay";

export interface RunRead {
  kind: "run" | "pass" | "unknown";
  scheme: RunScheme | null;
  direction: "left" | "right" | null;
  /** Track id of the ball carrier on a run. */
  carrier: number | null;
  /** Why it read the way it did, for a coach (and for tracing a wrong read). */
  why: string[];
}

/** Faster than this (yd/s) over the first half second is a man already running. */
const STARTS_MOVING_YARDS_PER_SECOND = 3;

/** Inside this many yards of the ball, on the line, are the five linemen. */
const LINE_HALF_WIDTH = 4.5;
/** When the line is measured: its first steps. */
const LINE_LOOK_SECONDS = 0.8;
/** The line's average step forward (yards) that says run, and back that says pass. */
const RUN_FIRE_YARDS = 0.25;
const PASS_SET_YARDS = -0.4;
/** A lineman who goes this far along the line in the first second, staying behind it, is pulling. */
const PULL_YARDS = 2.0;
const PULL_LOOK_SECONDS = 1.0;
const PULL_MAX_DEPTH_GAIN = 0.8;
/** On a pass, receivers get this deep by this time. */
const DEEP_YARDS = 7;
const DEEP_LOOK_SECONDS = 2.5;
/** A carrier has to cross the line by then for a run. */
const CROSS_BY_SECONDS = 4;
/** A carrier who gets this wide before he crosses: toss (fast) or outside zone. */
const TOSS_WIDTH = 7;
const TOSS_BY_SECONDS = 1.3;
const OUTSIDE_WIDTH = 4.5;
/** The whole line stepping this far one way, on average, is zone. */
const ZONE_STEP_YARDS = 0.6;

/** A pulling lineman moves this fast along the line; the first man to move a yard is the snap if `snapTime` can't say. */
const FIRST_MOVE_YARDS = 1.0;

/**
 * When the ball was snapped: `snapTime` (the fourth man to move), else the first man to move a yard (a
 * run where only a few move fast), less the same lead. Everyone's role is read from his stance before it,
 * and every movement is measured from it.
 */
/** Three or more offensive men already moving fast in the first half second: the clip began mid-play. */
function startsMoving(file: TrackedPlayFile): boolean {
  const moving = file.tracks.filter((t) => {
    if (t.team !== "offense" || t.points.length < 4) return false;
    const [t0, x0, y0] = t.points[0];
    const p = t.points.find((q) => q[0] - t0 >= 0.5);
    return !!p && Math.hypot(p[1] - x0, p[2] - y0) / (p[0] - t0) > STARTS_MOVING_YARDS_PER_SECOND;
  });
  return moving.length >= 3;
}

function snapOf(file: TrackedPlayFile): number {
  const t = snapTime(file);
  if (t > 0) return t;
  const first = file.tracks
    .filter((tr) => tr.team === "offense")
    .map((tr) => tr.points.find(([, x, y]) => Math.hypot(x - tr.start[0], y - tr.start[1]) > FIRST_MOVE_YARDS)?.[0])
    .filter((v): v is number => v !== undefined)
    .sort((a, b) => a - b)[0];
  return first !== undefined ? Math.max(0, first - 0.35) : 0;
}

/** Where a man was `dt` seconds after the snap `t0`: the nearest point within a quarter second. */
function at(t: TrackedPlayer, t0: number, dt: number): { x: number; y: number } | null {
  const want = t0 + dt;
  let best = t.points[0];
  for (const p of t.points) if (Math.abs(p[0] - want) < Math.abs(best[0] - want)) best = p;
  return Math.abs(best[0] - want) <= 0.25 ? { x: best[1], y: best[2] } : null;
}

/** When he first got past `y` after the snap (seconds after it), and where across he was then. */
function crossing(t: TrackedPlayer, t0: number, y: number): { dt: number; x: number } | null {
  const p = t.points.find(([s, , py]) => s >= t0 && py > y);
  return p ? { dt: p[0] - t0, x: p[1] } : null;
}

/** Whether a lineman pulled: somewhere in the first second, 2+ yards along the line without getting upfield of his stance. */
function pulled(t: TrackedPlayer, t0: number): number {
  for (const [s, x, y] of t.points) {
    if (s < t0 || s > t0 + PULL_LOOK_SECONDS) continue;
    if (Math.abs(x - t.start[0]) >= PULL_YARDS && y - t.start[1] <= PULL_MAX_DEPTH_GAIN) return Math.sign(x - t.start[0]);
  }
  return 0;
}

const sideOf = (x: number): "left" | "right" => (x < 0 ? "left" : "right");

export function readRun(file: TrackedPlayFile): RunRead {
  const why: string[] = [];
  // Roles from each man's stance (his track's start, before the snap); movement measured from the snap.
  const t0 = snapOf(file);
  // A clip whose first men are already moving began after the snap: nobody's stance was seen, so the read would be a guess
  // (play 34: calibrated 0.4 s after the snap, read as a toss when it was a pass).
  if (startsMoving(file)) {
    why.push("the film starts after the snap: no set to read from");
    return { kind: "unknown", scheme: null, direction: null, carrier: null, why };
  }
  const offense = file.tracks.filter((t) => t.team === "offense" && t.points.length >= 2);
  const none: RunRead = { kind: "unknown", scheme: null, direction: null, carrier: null, why };
  if (offense.length < 7) {
    why.push(`only ${offense.length} offensive players followed`);
    return none;
  }
  // The line: the five men nearest the ball, on the line's own row.
  const front = offense.filter((t) => Math.abs(t.start[0]) <= LINE_HALF_WIDTH && t.start[1] > -2.5).map((t) => t.start[1]).sort((a, b) => b - a);
  const lineY = front.length ? front[Math.min(2, front.length - 1)] : -0.8;
  const line = offense
    .filter((t) => Math.abs(t.start[0]) <= LINE_HALF_WIDTH && t.start[1] >= lineY - 0.9)
    .sort((a, b) => Math.abs(a.start[0]) - Math.abs(b.start[0]))
    .slice(0, 5);
  const lineIds = new Set(line.map((t) => t.id));
  const rest = offense.filter((t) => !lineIds.has(t.id));
  const backfield = rest.filter((t) => t.start[1] < lineY - 1.2 && Math.abs(t.start[0]) <= 6);
  const receivers = rest.filter((t) => !backfield.includes(t));
  const qb = [...backfield].sort((a, b) => Math.abs(a.start[0]) - Math.abs(b.start[0]) || b.start[1] - a.start[1])[0];

  // 1. The line's first steps.
  const steps = line.map((t) => {
    const p = at(t, t0, LINE_LOOK_SECONDS);
    return p ? { dx: p.x - t.start[0], dy: p.y - t.start[1] } : null;
  }).filter((s): s is { dx: number; dy: number } => s !== null);
  const lineDy = steps.length ? steps.reduce((s, v) => s + v.dy, 0) / steps.length : 0;
  const deep = receivers.filter((t) => {
    const p = at(t, t0, DEEP_LOOK_SECONDS);
    return p && p.y - lineY > DEEP_YARDS;
  }).length;

  // 2. The carrier: whoever from the backfield (or a receiver coming across behind the line) crosses it first.
  const candidates = [...backfield, ...receivers.filter((t) => Math.abs(t.start[0]) <= 12)]
    .map((t) => ({ t, c: crossing(t, t0, lineY + 1) }))
    .filter((v): v is { t: TrackedPlayer; c: { dt: number; x: number } } => !!v.c && v.c.dt <= CROSS_BY_SECONDS)
    .sort((a, b) => a.c.dt - b.c.dt);
  // A receiver only carries it if he came across behind the line first (a jet); one who just ran upfield is on a route.
  const carrierHit = candidates.find(({ t }) => {
    if (backfield.includes(t)) return true;
    const p = at(t, t0, 0.8);
    return !!p && p.y <= lineY + 0.5 && Math.abs(p.x - t.start[0]) >= 3;
  });

  const passLook = lineDy <= PASS_SET_YARDS || deep >= 2;
  if (!carrierHit || (passLook && deep >= 2)) {
    if (passLook) {
      why.push(lineDy <= PASS_SET_YARDS ? "line set back to pass block" : "", deep >= 2 ? `${deep} receivers released deep` : "");
      return { ...none, kind: "pass", why: why.filter(Boolean) };
    }
    why.push("nobody crossed the line, and it didn't look like a pass");
    return none;
  }
  const carrier = carrierHit.t;
  const cross = carrierHit.c;
  const direction = sideOf(Math.abs(cross.x) >= 0.75 ? cross.x : (at(carrier, t0, 1.0)?.x ?? cross.x) - carrier.start[0]);
  const dir = direction === "right" ? 1 : -1;
  why.push(`${carrier === qb ? "the quarterback" : backfield.includes(carrier) ? "a back" : "a receiver"} carried it ${direction}, across the line ${cross.dt.toFixed(1)} s after the snap`);

  // 3. The scheme.
  const pullingPlayside = line.filter((t) => pulled(t, t0) === dir);
  const lineLateral = steps.length ? steps.reduce((s, v) => s + v.dx * dir, 0) / steps.length : 0;
  const wideEarly = (() => {
    const p = at(carrier, t0, TOSS_BY_SECONDS);
    return p ? Math.abs(p.x) >= TOSS_WIDTH && p.y <= lineY + 1 : false;
  })();

  let scheme: RunScheme;
  if (carrier === qb && Math.abs(cross.x) < 1.5 && cross.dt < 1.5 && qb.start[1] > lineY - 2.5) {
    scheme = "sneak";
    why.push("the quarterback went straight ahead from under center");
  } else if (!backfield.includes(carrier)) {
    scheme = "jet";
    why.push("a receiver came across behind the line and carried it");
  } else if (wideEarly) {
    scheme = "toss";
    why.push(`the back was ${TOSS_WIDTH}+ yards wide within ${TOSS_BY_SECONDS} s`);
  } else if (pullingPlayside.length >= 2) {
    scheme = "counter";
    why.push(`${pullingPlayside.length} linemen pulled ${direction}`);
  } else if (pullingPlayside.length === 1) {
    scheme = "power";
    why.push(`one lineman pulled ${direction}`);
  } else if (lineDy <= PASS_SET_YARDS) {
    scheme = "draw";
    why.push("the line showed pass, then the back ran it");
  } else if (Math.abs(cross.x) >= OUTSIDE_WIDTH) {
    scheme = "outside-zone";
    why.push(`no pullers, and the back crossed ${Math.abs(cross.x).toFixed(0)} yards wide`);
  } else if (lineLateral >= ZONE_STEP_YARDS) {
    scheme = "zone";
    why.push(`no pullers, and the line stepped ${direction} together`);
  } else {
    scheme = "iso";
    why.push("no pullers, the line fired straight ahead and the back went up the middle");
  }
  // A run the line doesn't back up is more likely a tracking slip (one id handed to another man) than a run: real film read
  // plays 34 and 43, both passes, as a toss and a power from a quarterback whose track had jumped. Say unknown, not run.
  if (lineDy < RUN_FIRE_YARDS && scheme !== "draw" && scheme !== "sneak") {
    why.push("the line didn't fire forward, so a carrier crossing isn't enough to call it a run");
    return { ...none, why };
  }
  return { kind: "run", scheme, direction, carrier: carrier.id, why };
}

/** How the card's play call names each scheme (the words `runScheme` reads back). */
const SCHEME_CALL: Record<RunScheme, string> = {
  zone: "IZ",
  "outside-zone": "OZ",
  power: "POWER",
  counter: "COUNTER",
  iso: "ISO",
  draw: "DRAW",
  sneak: "QB SNEAK",
  toss: "TOSS",
  jet: "JET",
};

/** The play call a run read draws as: "POWER RT". */
export function runCall(read: RunRead): string {
  if (read.kind !== "run" || !read.scheme) return "";
  return read.scheme === "sneak" ? SCHEME_CALL.sneak : `${SCHEME_CALL[read.scheme]} ${read.direction === "left" ? "LT" : "RT"}`;
}

/**
 * A film card with no call of its own takes the run read's ("POWER RT", Run, the direction); the receivers'
 * film routes are dropped, since on a run they block. A card with a call (the sheet's) is left alone.
 */
export function applyRunRead(card: HudlPlayCard, read: RunRead): HudlPlayCard {
  if (read.kind !== "run" || card.playCall.trim()) return card;
  const note = `Film: ${read.why[0] ?? "run"}.`;
  return deriveCard({
    ...card,
    playCall: runCall(read),
    playType: "Run",
    playDir: read.direction === "left" ? "L" : "R",
    routeOverrides: undefined,
    notes: card.notes.trim() ? `${card.notes.trim()} ${note}` : note,
  });
}

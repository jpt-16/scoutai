/**
 * Scout D from film: the defense's picture at the snap. Where every defender stood (yards from the
 * ball, in the offense's view), what each one is (down lineman, backer, corner, safety), the front
 * that adds up to ("4-2-5", "3-3-5", "Bear"), the safety shell, and those spots put on the card's
 * own defenders. Rolled up by offensive formation, it is also the staff's Secondary table
 * (`secondary.ts`): how this defense lines its corners and safeties up against each formation.
 *
 * Everything here is from the pre-snap picture, which is the part of the film read that holds up
 * (the formation reads were right on the first real clips), not from tracking anyone after the snap.
 */

import { buildDiagram, FIELD, fromCardPoint, YARD_PX, YARD_X } from "./formations";
import { deriveCard, type FormationKey, type FrontKey, type HudlPlayCard } from "./hudlParser";
import type { DbAlignment, DbAlignments, DbAnchor, DbShade, DbSlot, DbSpot } from "./secondary";
import { snapTime, type TrackedPlayer, type TrackedPlayFile } from "./trackedPlay";

/** Down lineman, box backer, a DB walked out over a slot (nickel / overhang), corner, safety. */
export type DefRole = "dl" | "lb" | "nb" | "cb" | "s";

export interface FilmDefender {
  /** Yards from the ball: x to the offense's right, y past the line. */
  x: number;
  y: number;
  role: DefRole;
}

export interface DefenseRead {
  defenders: FilmDefender[];
  /** Linemen-backers-DBs, the way a staff names it: "4-2-5", "3-3-5", or "Bear". */
  label: string;
  frontKey: Exclude<FrontKey, "unknown">;
  /**
   * Whether the count makes a real defense (3-6 down, 1-4 backers, 4-6 DBs). On a low sideline camera the line hides
   * behind the offense's and the sideline creeps in ("1-1-8"): then the front isn't written on the card, only noted.
   */
  plausible: boolean;
  /** Safeties 10+ yards deep. */
  shell: "0-high" | "1-high" | "2-high";
  /** The offense's receivers at the snap (yards), for reading where the DBs are over. */
  receivers: { x: number; y: number }[];
}

/** A down lineman is on the ball: within this many yards of the line, and no wider than this from the ball. */
const DL_MAX_DEPTH = 2.0;
const DL_MAX_WIDTH = 7.0;
/** Inside this many yards of the ball is the box (the tackles stand ~3.5 out, a tight end ~5). */
const BOX_HALF_WIDTH = 5.0;
/** A safety is at least this deep; a "high" one at least the second. */
const SAFETY_MIN_DEPTH = 8.0;
const HIGH_SAFETY_DEPTH = 10.0;
/** People further from the ball than this aren't in the play's picture (the bench, the far sideline). */
const MAX_DEPTH = 25;
const MAX_WIDTH = 27;
/** The fewest defenders that make a picture worth reading (detections miss a man or two). */
const MIN_DEFENDERS = 8;
const MAX_DEFENDERS = 11;
/** How far from the snap a man's spot can be taken from (seconds): the nearest point of his track. */
const SNAP_WINDOW = 0.4;

/** Where a man stood at time `t`: the point of his track nearest it, if one is close enough. */
function spotAt(track: TrackedPlayer, t: number): { x: number; y: number } | null {
  let best: [number, number, number] | null = null;
  for (const p of track.points) if (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
  return best && Math.abs(best[0] - t) <= SNAP_WINDOW ? { x: best[1], y: best[2] } : null;
}

/** The defense at the snap, or null when too few defenders were found to say. */
export function readDefense(file: TrackedPlayFile): DefenseRead | null {
  const t = snapTime(file);
  const at = (team: string) =>
    file.tracks
      .filter((tr) => tr.team === team)
      .map((tr) => spotAt(tr, t))
      .filter((p): p is { x: number; y: number } => p !== null);
  // Receivers: offensive men outside the box, near the line.
  const receivers = at("offense").filter((p) => Math.abs(p.x) > BOX_HALF_WIDTH - 0.5 && p.y > -3);
  const widest = (dir: number) => Math.max(BOX_HALF_WIDTH, ...receivers.filter((r) => r.x * dir > 0).map((r) => r.x * dir));
  // Eleven at most: anyone well outside the widest receiver (the sideline) goes first, then the deepest and widest.
  const spots = at("defense")
    .filter((p) => p.y > -0.5 && p.y <= MAX_DEPTH && Math.abs(p.x) <= MAX_WIDTH)
    .map((p) => ({ p, cost: (Math.abs(p.x) > widest(Math.sign(p.x) || 1) + 4 ? 100 : 0) + p.y + 0.3 * Math.abs(p.x) }))
    .sort((a, b) => a.cost - b.cost)
    .slice(0, MAX_DEFENDERS)
    .map(({ p }) => p);
  if (spots.length < MIN_DEFENDERS) return null;

  const role = new Map<{ x: number; y: number }, DefRole>();
  for (const p of spots) {
    if (p.y <= DL_MAX_DEPTH && Math.abs(p.x) <= DL_MAX_WIDTH) role.set(p, "dl");
    else if (p.y >= SAFETY_MIN_DEPTH) role.set(p, "s");
  }
  // A corner on each side: the man (not on the line, not deep) nearest that side's widest receiver, outside the box.
  for (const dir of [-1, 1]) {
    const free = spots.filter((p) => !role.has(p) && p.x * dir > BOX_HALF_WIDTH);
    if (!free.length) continue;
    const wide = receivers.filter((r) => r.x * dir > 0).sort((a, b) => b.x * dir - a.x * dir)[0];
    const corner = wide
      ? free.sort((a, b) => Math.hypot(a.x - wide.x, a.y - wide.y) - Math.hypot(b.x - wide.x, b.y - wide.y))[0]
      : free.sort((a, b) => b.x * dir - a.x * dir)[0];
    if (wide || Math.abs(corner.x) > 10) role.set(corner, "cb");
  }
  // Everyone left is a backer in the box, or walked out over a slot: a nickel, counted with the DBs.
  for (const p of spots) if (!role.has(p)) role.set(p, Math.abs(p.x) > BOX_HALF_WIDTH + 1 ? "nb" : "lb");

  const defenders = spots.map((p) => ({ ...p, role: role.get(p)! }));
  const count = (r: DefRole) => defenders.filter((d) => d.role === r).length;
  const dl = count("dl");
  const lb = count("lb");
  const db = count("nb") + count("cb") + count("s");
  const line = defenders.filter((d) => d.role === "dl").sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
  // Bear: five or more down, with the center and both guards covered (three men within a guard's width of the ball).
  const bear = dl >= 5 && line.slice(0, 3).every((d) => Math.abs(d.x) <= 2.6);
  const frontKey: Exclude<FrontKey, "unknown"> = bear ? "bear" : dl >= 5 ? "5-2" : dl === 3 || dl < 3 ? "3-4" : "4-3";
  const high = defenders.filter((d) => d.role === "s" && d.y >= HIGH_SAFETY_DEPTH).length;
  return {
    defenders,
    plausible: dl >= 3 && dl <= 6 && lb >= 1 && lb <= 4 && db >= 4 && db <= 6,
    label: bear ? "Bear" : `${dl}-${lb}-${db}`,
    frontKey,
    shell: high >= 2 ? "2-high" : high === 1 ? "1-high" : "0-high",
    receivers,
  };
}

const GROUP: Record<string, "dl" | "lb" | "cb" | "s"> = { E: "dl", T: "dl", N: "dl", W: "lb", M: "lb", S: "lb", B: "lb", C: "cb", FS: "s", SS: "s" };

/**
 * The card's defenders moved to where the film had them, keyed by the card's own ids (`E1`, `C2`, `FS1`),
 * in the formation's own coordinates (like a coach's drag). Each film man goes to the nearest card defender
 * of the same kind first; a nickel (a fifth DB) or a sixth backer takes the nearest leftover id.
 */
export function defenseOverridesFor(card: HudlPlayCard, read: DefenseRead): Record<string, { x: number; y: number }> {
  const diagram = buildDiagram({ ...card, defenseOverrides: undefined }, "team", "defense");
  const slots = diagram.defense.map((d) => {
    const p = fromCardPoint(diagram, { x: d.x, y: d.y });
    return { id: d.id, group: GROUP[d.label] ?? "lb", x: p.x, y: p.y };
  });
  const film = read.defenders.map((d) => ({
    group: d.role === "nb" ? "lb" : d.role, // a nickel takes a backer's spot on the card if no DB's is left
    x: Math.round(FIELD.center.x + d.x * YARD_X),
    y: Math.round(FIELD.los - d.y * YARD_PX),
  }));
  // Down linemen only ever take a line id, and a line id only a down lineman; across the rest a wrong kind costs a few yards.
  const pairs: [number, number, number][] = [];
  film.forEach((f, i) =>
    slots.forEach((s, j) => {
      const line = (f.group === "dl") !== (s.group === "dl");
      if (line) return;
      pairs.push([Math.hypot(f.x - s.x, f.y - s.y) + (f.group === s.group ? 0 : 40), i, j]);
    }),
  );
  pairs.sort((a, b) => a[0] - b[0]);
  const usedFilm = new Set<number>();
  const usedSlot = new Set<number>();
  const out: Record<string, { x: number; y: number }> = {};
  for (const [, i, j] of pairs) {
    if (usedFilm.has(i) || usedSlot.has(j)) continue;
    usedFilm.add(i);
    usedSlot.add(j);
    out[slots[j].id] = { x: film[i].x, y: film[i].y };
  }
  return out;
}

/**
 * A card with the film's defense on it. A front the sheet tagged stays (the coach's word wins); a blank one
 * takes the film's ("4-2-5"). The defenders go where they stood, and the notes say what the film saw.
 */
export function applyDefenseRead(card: HudlPlayCard, read: DefenseRead): HudlPlayCard {
  if (!read.plausible) {
    const note = `Check D: film read ${read.label}, not a real front.`;
    return deriveCard({ ...card, notes: card.notes.trim() ? `${card.notes.trim()} ${note}` : note });
  }
  const defFront = card.defFront.trim() ? card.defFront : read.label;
  const withFront = deriveCard({ ...card, defFront });
  const note = `Film D: ${read.label}, ${read.shell}.`;
  return deriveCard({
    ...withFront,
    defenseOverrides: defenseOverridesFor(withFront, read),
    notes: withFront.notes.trim() ? `${withFront.notes.trim()} ${note}` : note,
  });
}

/* -------------------------------------------------------------------------- */
/*                  The secondary per formation, from the film                */
/* -------------------------------------------------------------------------- */

/** A DB this close (yards) across to a receiver is "over" him; further, he's over the ball or the hash. */
const OVER_YARDS = 3.5;
const HASH_YARDS = 6.2;
/** Inside / outside shade, else head-up (yards). */
const SHADE_YARDS = 0.75;

/** One play's corners and safeties, as Secondary-table spots. */
export function dbSpots(read: DefenseRead): Partial<Record<DbSlot, DbSpot>> {
  const right = read.receivers.filter((r) => r.x > 0).length;
  const left = read.receivers.length - right;
  const strongDir = left > right ? -1 : 1;
  const sideOf = (x: number) => (x * strongDir >= 0 ? "strong" : "weak") as "strong" | "weak";
  const spotOf = (d: FilmDefender, side: "strong" | "weak"): DbSpot => {
    const dir = side === "strong" ? strongDir : -strongDir;
    const mine = read.receivers.filter((r) => r.x * dir > 0).sort((a, b) => b.x * dir - a.x * dir); // outside in
    const nearest = mine
      .map((r, i) => ({ i, gap: Math.abs(r.x - d.x), r }))
      .sort((a, b) => a.gap - b.gap)[0];
    let anchor: DbAnchor;
    let ref: number;
    if (nearest && nearest.gap <= OVER_YARDS) {
      anchor = String(Math.min(nearest.i + 1, 3)) as DbAnchor;
      ref = nearest.r.x;
    } else if (Math.abs(d.x) < 2) {
      anchor = "ball";
      ref = 0;
    } else {
      anchor = "hash";
      ref = dir * HASH_YARDS;
    }
    const out = (d.x - ref) * dir;
    const shade: DbShade = anchor === "ball" ? "head-up" : out > SHADE_YARDS ? "outside" : out < -SHADE_YARDS ? "inside" : "head-up";
    return { depth: Math.round(d.y * 2) / 2, anchor, shade, side };
  };
  const out: Partial<Record<DbSlot, DbSpot>> = {};
  for (const c of read.defenders.filter((d) => d.role === "cb")) {
    const side = sideOf(c.x);
    out[side === "strong" ? "cs" : "cw"] = spotOf(c, side);
  }
  const safeties = read.defenders.filter((d) => d.role === "s").sort((a, b) => b.x * strongDir - a.x * strongDir);
  if (safeties.length >= 2) {
    out.ss = spotOf(safeties[0], sideOf(safeties[0].x));
    out.fs = spotOf(safeties[safeties.length - 1], sideOf(safeties[safeties.length - 1].x));
  } else if (safeties.length === 1) {
    out.fs = spotOf(safeties[0], sideOf(safeties[0].x));
  }
  return out;
}

function mode<T>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

/** The typical spot: the middle depth, the most common anchor, shade and side. */
function typical(spots: DbSpot[]): DbSpot {
  const depths = spots.map((s) => s.depth).sort((a, b) => a - b);
  const sides = spots.map((s) => s.side).filter((s): s is "strong" | "weak" => !!s);
  return {
    depth: depths[Math.floor(depths.length / 2)],
    anchor: mode(spots.map((s) => s.anchor)),
    shade: mode(spots.map((s) => s.shade)),
    ...(sides.length ? { side: mode(sides) } : {}),
  };
}

/**
 * How this defense lines its corners and safeties up against each formation, from every play read:
 * the Secondary table, marked `source: "film"`. A formation the coach already set keeps the coach's.
 */
export function secondaryFromFilm(
  plays: { formationKey: FormationKey; read: DefenseRead }[],
  existing: DbAlignments = {},
): DbAlignments {
  const byFormation = new Map<FormationKey, Partial<Record<DbSlot, DbSpot>>[]>();
  for (const { formationKey, read } of plays) {
    if (formationKey === "unknown" || !read.plausible) continue;
    const list = byFormation.get(formationKey) ?? [];
    list.push(dbSpots(read));
    byFormation.set(formationKey, list);
  }
  const out: DbAlignments = { ...existing };
  for (const [key, list] of byFormation) {
    if (existing[key]?.source === "coach") continue;
    const table: DbAlignment = { source: "film" };
    for (const slot of ["cs", "cw", "fs", "ss"] as DbSlot[]) {
      const spots = list.map((s) => s[slot]).filter((s): s is DbSpot => !!s);
      if (spots.length) table[slot] = typical(spots);
    }
    out[key] = table;
  }
  return out;
}

/** "Trips: 4-2-5 (3 of 4), 2-high" — the fronts this defense showed against each formation. */
export function frontsByFormation(plays: { formation: string; read: DefenseRead }[]): string[] {
  const by = new Map<string, DefenseRead[]>();
  for (const { formation, read } of plays) if (read.plausible) by.set(formation, [...(by.get(formation) ?? []), read]);
  return [...by].map(([formation, reads]) => {
    const front = mode(reads.map((r) => r.label));
    const shell = mode(reads.map((r) => r.shell));
    return `${formation || "Other"}: ${front} (${reads.filter((r) => r.label === front).length} of ${reads.length}), ${shell}`;
  });
}

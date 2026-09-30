/**
 * Scout D secondary: where the opponent's corners and safeties line up
 * against each formation, set once per formation and drawn on every Scout D
 * card in it. A coach types it ("FS 12 middle, SS 8 #3, corners 7 outside",
 * `parseSecondaryText`) or the AI reads it off a pre-snap clip
 * (`/api/read-secondary`, `alignmentFromFilm`); either way it lands in the
 * same table, saved with the opponent's script (`StoredScript.dbAlignments`).
 *
 * Positions are relative to the offense: the strong / weak side (where the
 * receivers are), which receiver a DB is over (#1 outside-in, the ball, the
 * hash), his shade, and his depth in yards off the line of scrimmage. So one
 * table works for Trips Right and Trips Left alike. A per-play drag with
 * Adjust X's still wins over it.
 *
 * Framework-free, no imports from formations.ts (which imports this).
 */

import type { FormationKey } from "./hudlParser";

export type DbSlot = "cs" | "cw" | "fs" | "ss";
export type DbAnchor = "1" | "2" | "3" | "ball" | "hash";
export type DbShade = "inside" | "head-up" | "outside";
export type DbSide = "strong" | "weak";

export interface DbSpot {
  /** Yards off the line of scrimmage. */
  depth: number;
  /** Over which receiver on his side (#1 = outside), the ball, or the hash. */
  anchor: DbAnchor;
  shade: DbShade;
  /** Safeties only: which side of the formation (corners are one per side). */
  side?: DbSide;
}

export type DbAlignment = Partial<Record<DbSlot, DbSpot>> & { source?: "coach" | "film" };
export type DbAlignments = Partial<Record<FormationKey, DbAlignment>>;

export const DB_SLOTS: DbSlot[] = ["cs", "cw", "fs", "ss"];
export const DB_SLOT_LABELS: Record<DbSlot, string> = {
  cs: "Strong corner",
  cw: "Weak corner",
  fs: "Free safety",
  ss: "Strong safety",
};
export const DB_ANCHORS: { value: DbAnchor; label: string }[] = [
  { value: "1", label: "#1" },
  { value: "2", label: "#2" },
  { value: "3", label: "#3" },
  { value: "ball", label: "Ball" },
  { value: "hash", label: "Hash" },
];
export const DB_SHADES: { value: DbShade; label: string }[] = [
  { value: "inside", label: "Inside" },
  { value: "head-up", label: "Head up" },
  { value: "outside", label: "Outside" },
];

/** Deepest a DB can be drawn: the card shows 20 yards past the line. */
export const MAX_DB_DEPTH = 19;

/** Where the card puts DBs before a coach sets anything. */
export function defaultAlignment(): Required<Pick<DbAlignment, DbSlot>> {
  return {
    cs: { depth: 6, anchor: "1", shade: "head-up" },
    cw: { depth: 6, anchor: "1", shade: "head-up" },
    fs: { depth: 12, anchor: "hash", shade: "head-up", side: "weak" },
    ss: { depth: 12, anchor: "hash", shade: "head-up", side: "strong" },
  };
}

const clampDepth = (n: number) => Math.min(MAX_DB_DEPTH, Math.max(0, Math.round(n * 2) / 2));

/* -------------------------------------------------------------------------- */
/*                                 Placement                                  */
/* -------------------------------------------------------------------------- */

const LOS_Y = 140;
const YARD_PX = 7;
const YARD_X = 500 / (160 / 3);
const HASH_OFFSET = 83;

/**
 * Where a DB stands, in the card's own un-flipped coordinates (offense view,
 * defense above the line, before the hash shift), given the receivers' x on
 * each side (outside-in) and which way the strength is (+1 right, -1 left).
 */
export function placeDb(
  slot: DbSlot,
  spot: DbSpot,
  receivers: { strong: number[]; weak: number[] },
  strongDir: 1 | -1,
): { x: number; y: number } {
  const side: DbSide =
    slot === "cs" ? "strong" : slot === "cw" ? "weak" : (spot.side ?? (slot === "ss" ? "strong" : "weak"));
  const dir = side === "strong" ? strongDir : -strongDir;
  const list = side === "strong" ? receivers.strong : receivers.weak;
  let x: number;
  if (spot.anchor === "ball") x = 250;
  else if (spot.anchor === "hash") x = 250 + dir * HASH_OFFSET;
  else {
    const n = Number(spot.anchor);
    // No #3 on this side: the innermost receiver there, else the hash.
    x = list[Math.min(n, list.length) - 1] ?? 250 + dir * HASH_OFFSET;
  }
  // Inside is toward the ball, outside toward his sideline; a yard and a half.
  if (spot.anchor !== "ball") {
    if (spot.shade === "inside") x -= dir * 1.5 * YARD_X;
    if (spot.shade === "outside") x += dir * 1.5 * YARD_X;
  }
  return {
    x: Math.min(488, Math.max(12, x)),
    y: LOS_Y - clampDepth(spot.depth) * YARD_PX,
  };
}

/* -------------------------------------------------------------------------- */
/*                                Typed entry                                 */
/* -------------------------------------------------------------------------- */

const ROLE_PATTERNS: [RegExp, DbSlot[]][] = [
  [/\b(STRONG|FIELD)\s*(C|CB|CORNER)\b/, ["cs"]],
  [/\b(WEAK|BOUNDARY|BACKSIDE)\s*(C|CB|CORNER)\b/, ["cw"]],
  [/\b(CORNERS|CBS|CS)\b/, ["cs", "cw"]],
  [/\b(C|CB|CORNER)\b/, ["cs", "cw"]],
  [/\b(SAFETIES|SAFETYS)\b/, ["fs", "ss"]],
  [/\b(FS|FREE)\b/, ["fs"]],
  [/\b(SS|STRONG SAFETY|ROVER|SPUR)\b/, ["ss"]],
];

/**
 * Reads a typed line of alignment ("FS 12 middle, SS 8 over #3, corners 7
 * outside") onto a table: each comma / line is one DB (or both corners, or
 * both safeties), with a depth in yards, who he's over, a shade and, for a
 * safety, a side. Returns the parts it couldn't read.
 */
export function parseSecondaryText(
  text: string,
  base: DbAlignment = defaultAlignment(),
): { alignment: DbAlignment; unread: string[] } {
  const alignment: DbAlignment = { ...base };
  const unread: string[] = [];
  for (const raw of text.split(/[,;\n]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const t = ` ${part.toUpperCase().replace(/[^A-Z0-9#.\s-]/g, " ")} `;
    const role = ROLE_PATTERNS.find(([re]) => re.test(t));
    if (!role) {
      unread.push(part);
      continue;
    }
    const anchorMatch = t.match(/#\s*([123])/);
    const depthMatch = t.replace(/#\s*\d/g, " ").match(/\b(\d{1,2}(?:\.5)?)\b/);
    let anchor: DbAnchor | undefined = anchorMatch ? (anchorMatch[1] as DbAnchor) : undefined;
    if (!anchor && /\b(MIDDLE|MOF|OVER THE BALL|OVER BALL|CENTER|CENTERFIELD)\b/.test(t)) anchor = "ball";
    if (!anchor && /\bHASH(ES)?\b/.test(t)) anchor = "hash";
    if (!anchor && /\bSLOT\b/.test(t)) anchor = "2";
    const shade: DbShade | undefined = /\b(INSIDE|IN|INSIDE LEVERAGE)\b/.test(t)
      ? "inside"
      : /\b(OUTSIDE|OUT|OUTSIDE LEVERAGE)\b/.test(t)
        ? "outside"
        : /\b(HEAD UP|HEAD-UP|HEADUP|OVER)\b/.test(t)
          ? "head-up"
          : undefined;
    const side: DbSide | undefined = /\b(WEAK|BACKSIDE|BOUNDARY)\b/.test(t)
      ? "weak"
      : /\b(STRONG|FIELD|TRIPS SIDE)\b/.test(t)
        ? "strong"
        : undefined;
    if (!depthMatch && !anchor && !shade) {
      unread.push(part);
      continue;
    }
    for (const slot of role[1]) {
      const current = alignment[slot] ?? defaultAlignment()[slot];
      alignment[slot] = {
        ...current,
        ...(depthMatch ? { depth: clampDepth(Number(depthMatch[1])) } : {}),
        ...(anchor ? { anchor } : {}),
        ...(shade ? { shade } : {}),
        ...((slot === "fs" || slot === "ss") && side ? { side } : {}),
      };
    }
  }
  return { alignment: { ...alignment, source: "coach" }, unread };
}

/** The table as a line a coach can read back ("C 7 #1 outside, FS 12 ball, …"). */
export function describeAlignment(alignment: DbAlignment): string {
  const short: Record<DbSlot, string> = { cs: "Strong C", cw: "Weak C", fs: "FS", ss: "SS" };
  return DB_SLOTS.filter((s) => alignment[s])
    .map((s) => {
      const spot = alignment[s]!;
      const anchor = spot.anchor === "ball" ? "over the ball" : spot.anchor === "hash" ? "on the hash" : `#${spot.anchor}`;
      const shade = spot.anchor === "ball" || spot.shade === "head-up" ? "" : ` ${spot.shade}`;
      const side = (s === "fs" || s === "ss") && spot.side ? ` ${spot.side}` : "";
      return `${short[s]} ${spot.depth} yds, ${anchor}${shade}${side}`;
    })
    .join(" · ");
}

/* -------------------------------------------------------------------------- */
/*                                 From film                                  */
/* -------------------------------------------------------------------------- */

export const FILM_ANCHORS = ["1", "2", "3", "ball", "hash"] as const;

/** The film AI's answer for one DB (see `/api/read-secondary`). */
export interface FilmDb {
  slot: string;
  depthYards: number;
  anchor: string;
  shade: string;
  side?: string;
}

/** Turns the film AI's read into a table, dropping anything malformed. */
export function alignmentFromFilm(dbs: unknown): DbAlignment | null {
  if (!Array.isArray(dbs)) return null;
  const alignment: DbAlignment = { source: "film" };
  for (const db of dbs as Partial<FilmDb>[]) {
    const slot = DB_SLOTS.find((s) => s === db?.slot);
    if (!slot || typeof db.depthYards !== "number" || !Number.isFinite(db.depthYards)) continue;
    const anchor = FILM_ANCHORS.find((a) => a === db.anchor) ?? "1";
    const shade = DB_SHADES.find((s) => s.value === db.shade)?.value ?? "head-up";
    const side = db.side === "weak" || db.side === "strong" ? db.side : undefined;
    alignment[slot] = {
      depth: clampDepth(db.depthYards),
      anchor,
      shade,
      ...((slot === "fs" || slot === "ss") && side ? { side } : {}),
    };
  }
  return DB_SLOTS.some((s) => alignment[s]) ? alignment : null;
}

import type { FormationKey, FrontKey, HudlPlayCard, Side } from "./hudlParser";
import {
  callWords,
  insideAlignment,
  isWingSlideCall,
  matchConcept,
  SLIDE_BLOCKS,
  SLIDE_PATH,
  type ConceptRoute,
  type ConceptSlot,
} from "./conceptMapper";
import { placeDb, type DbAlignment, type DbSlot } from "./secondary";
import {
  alignDefense,
  coverageStyleFor,
  safetyDepthFor,
  safetyY,
  type AlignDefender,
  type DefensiveAlignment,
} from "./defensiveAligner";

/**
 * Coordinate system for every scout card diagram:
 * - SVG viewBox is 500 x 300; x runs across the field, y runs downfield.
 * - The ball / center sits at (250, 150). The line of scrimmage is y = 140.
 * - Offense only: players are below the LOS, blocks and routes go upfield.
 * - Hash marks sit at x = 167 and x = 333 (thirds of the field, HS rules).
 * Formations are drawn with the strength to the RIGHT; `buildDiagram`
 * mirrors them for left-handed sets.
 */
export const FIELD = {
  width: 500,
  height: 300,
  los: 140,
  center: { x: 250, y: 150 },
  hashX: { L: 167, M: 250, R: 333 },
} as const;

export type Point = { x: number; y: number };
type Pt = [number, number];

export type Role = "OL" | "QB" | "RB" | "FB" | "TE" | "WR";

export interface Player {
  /** Letter drawn in the circle: Q, F, H, X, Y, Z. Linemen are unlabeled. */
  label: string;
  role: Role;
  x: number;
  y: number;
  /** The center (drawn filled: he has the ball). */
  ball?: boolean;
}

interface Slot {
  label: string;
  role: Role;
  at: Pt;
}

interface FormationShape {
  qb: Pt;
  /** Backs, ordered so the LAST one is the primary ball carrier. */
  backs: Slot[];
  /** Receivers and tight ends. */
  skill: Slot[];
}

const OFFENSIVE_LINE: Slot[] = [
  // Linemen (r 7, the center a square of 14) sit 2 px further up than skill players (r 9) at 150,
  // so every on-ball player's front edge is flush with the LOS bar's back edge at y = 141
  // (the radii live in ScoutCard.tsx).
  { label: "", role: "OL", at: [206, 148] },
  { label: "", role: "OL", at: [228, 148] },
  { label: "", role: "OL", at: [250, 148] },
  { label: "", role: "OL", at: [272, 148] },
  { label: "", role: "OL", at: [294, 148] },
];

export const FORMATIONS: Record<Exclude<FormationKey, "unknown">, FormationShape> = {
  // Deuces Gun: F is the slot (a receiver), H is the back in the backfield.
  spread: {
    qb: [250, 190],
    backs: [{ label: "H", role: "RB", at: [276, 192] }],
    skill: [
      { label: "X", role: "WR", at: [36, 150] },
      { label: "F", role: "WR", at: [112, 160] },
      { label: "Y", role: "WR", at: [388, 160] },
      { label: "Z", role: "WR", at: [464, 160] },
    ],
  },
  trips: {
    qb: [250, 190],
    backs: [{ label: "F", role: "RB", at: [224, 192] }],
    skill: [
      { label: "X", role: "WR", at: [36, 150] },
      { label: "H", role: "WR", at: [336, 160] },
      { label: "Y", role: "WR", at: [400, 160] },
      { label: "Z", role: "WR", at: [464, 150] },
    ],
  },
  "i-form": {
    qb: [250, 166],
    backs: [
      { label: "F", role: "FB", at: [250, 198] },
      { label: "H", role: "RB", at: [250, 230] },
    ],
    skill: [
      { label: "X", role: "WR", at: [40, 150] },
      { label: "Y", role: "TE", at: [316, 150] },
      { label: "Z", role: "WR", at: [444, 160] },
    ],
  },
  "double-eagle": {
    qb: [250, 166],
    backs: [{ label: "F", role: "RB", at: [250, 214] }],
    skill: [
      { label: "X", role: "TE", at: [184, 150] },
      { label: "Y", role: "TE", at: [316, 150] },
      { label: "H", role: "WR", at: [162, 166] },
      { label: "Z", role: "WR", at: [338, 166] },
    ],
  },
  // Pro: QB under center, F behind him, H behind the F.
  pro: {
    qb: [250, 166],
    backs: [
      { label: "F", role: "FB", at: [250, 198] },
      { label: "H", role: "RB", at: [250, 230] },
    ],
    skill: [
      { label: "X", role: "WR", at: [40, 150] },
      { label: "Y", role: "TE", at: [316, 150] },
      { label: "Z", role: "WR", at: [444, 160] },
    ],
  },
  // Split Pro (only when the formation says SPLIT): backs side by side.
  "split-pro": {
    qb: [250, 166],
    backs: [
      { label: "F", role: "FB", at: [222, 206] },
      { label: "H", role: "RB", at: [278, 206] },
    ],
    skill: [
      { label: "X", role: "WR", at: [40, 150] },
      { label: "Y", role: "TE", at: [316, 150] },
      { label: "Z", role: "WR", at: [444, 160] },
    ],
  },
};

export const FORMATION_LABELS: Record<FormationKey, string> = {
  spread: "Spread",
  trips: "Trips",
  "i-form": "I-Form",
  "double-eagle": "Double Eagle",
  pro: "Pro",
  "split-pro": "Split Pro",
  unknown: "Other",
};

/* -------------------------------------------------------------------------- */
/*                         Scout defense alignment                            */
/* -------------------------------------------------------------------------- */

interface DefSlot {
  label: string;
  at: Pt;
}

interface FrontShape {
  /** Defensive line: dropped in 7v7. */
  dl: DefSlot[];
  lb: DefSlot[];
}

/** Fronts drawn against a strength-right formation; mirrored for left. */
export const FRONTS: Record<Exclude<FrontKey, "unknown">, FrontShape> = {
  "4-3": {
    dl: [
      { label: "E", at: [196, 127] },
      { label: "T", at: [238, 127] },
      { label: "T", at: [266, 127] },
      { label: "E", at: [306, 127] },
    ],
    lb: [
      { label: "W", at: [204, 94] },
      { label: "M", at: [250, 90] },
      { label: "S", at: [296, 94] },
    ],
  },
  "3-4": {
    dl: [
      { label: "E", at: [214, 127] },
      { label: "N", at: [250, 127] },
      { label: "E", at: [286, 127] },
    ],
    lb: [
      { label: "W", at: [172, 118] },
      { label: "M", at: [228, 92] },
      { label: "B", at: [272, 92] },
      { label: "S", at: [328, 118] },
    ],
  },
  "5-2": {
    dl: [
      { label: "E", at: [184, 127] },
      { label: "T", at: [216, 127] },
      { label: "N", at: [250, 127] },
      { label: "T", at: [284, 127] },
      { label: "E", at: [316, 127] },
    ],
    lb: [
      { label: "W", at: [226, 92] },
      { label: "M", at: [274, 92] },
    ],
  },
  bear: {
    dl: [
      { label: "E", at: [178, 127] },
      { label: "T", at: [210, 127] },
      { label: "N", at: [250, 127] },
      { label: "T", at: [290, 127] },
      { label: "E", at: [322, 127] },
    ],
    lb: [
      { label: "W", at: [228, 92] },
      { label: "M", at: [272, 92] },
    ],
  },
};

export const FRONT_LABELS: Record<FrontKey, string> = {
  "4-3": "4-3",
  "3-4": "3-4",
  "5-2": "5-2",
  bear: "Bear",
  unknown: "Other",
};

export interface Defender {
  /** Stable id: the label plus its count ("C1", "C2", "FS1"), used to save moved defenders. */
  id: string;
  /** E, T, N (line), W, M, S, B (backers), C, FS, SS (secondary). */
  label: string;
  x: number;
  y: number;
}

/**
 * Where the scout defense lines up against the (already mirrored) offense:
 * the front's box players, corners over the widest receiver on each side,
 * and safeties shaded to the receiver-heavy side (Bear rolls one down). Then
 * the alignment rules (src/lib/defensiveAligner.ts): a safety rolls over the
 * #2 on a side with two or more split receivers, and backers walk out to any
 * receiver still alone in space. The staff's secondary table, the play's
 * safety depth and a coach's drags win, in that order.
 */
function buildDefense(
  frontKey: Exclude<FrontKey, "unknown">,
  skill: { label: string; at: Pt }[],
  strength: Side,
  dropLine: boolean,
  overrides: Record<string, { x: number; y: number }> = {},
  alignment?: DbAlignment,
  coverage = "",
  call?: DefensiveAlignment,
): { defenders: Defender[]; notes: string[] } {
  const front = FRONTS[frontKey];
  const xs = skill.map(({ at: [x] }) => x);
  const leftmost = Math.min(...xs);
  const rightmost = Math.max(...xs);
  const rightCount = xs.filter((x) => x > 250).length;
  const leftCount = xs.length - rightCount;
  const shade = rightCount > leftCount ? 24 : leftCount > rightCount ? -24 : 0;
  const cornerY = (x: number) => (x < 110 || x > 390 ? 112 : 100);
  const strongDir = shade !== 0 ? Math.sign(shade) : strength === "left" ? -1 : 1;
  const secondary: DefSlot[] = [
    { label: "C", at: [Math.min(leftmost, 150), cornerY(leftmost)] },
    { label: "C", at: [Math.max(rightmost, 350), cornerY(rightmost)] },
    ...(frontKey === "bear"
      ? [
          { label: "FS", at: [250 + shade, 48] as Pt },
          { label: "SS", at: [250 + strongDir * 70, 104] as Pt },
        ]
      : [
          { label: strongDir > 0 ? "FS" : "SS", at: [180 + shade, 52] as Pt },
          { label: strongDir > 0 ? "SS" : "FS", at: [320 + shade, 52] as Pt },
        ]),
  ];
  // The staff's own secondary for this formation (src/lib/secondary.ts), if set.
  if (alignment) {
    const outsideIn = (a: number, b: number) => Math.abs(b - 250) - Math.abs(a - 250);
    const receivers = {
      strong: xs.filter((x) => (x - 250) * strongDir > 0).sort(outsideIn),
      weak: xs.filter((x) => (x - 250) * strongDir < 0).sort(outsideIn),
    };
    secondary.forEach((slotDef, i) => {
      const slot: DbSlot =
        slotDef.label === "C" ? ((i === 0 ? -1 : 1) === strongDir ? "cs" : "cw") : slotDef.label === "FS" ? "fs" : "ss";
      const spot = alignment[slot];
      if (!spot) return;
      const at = placeDb(slot, spot, receivers, strongDir > 0 ? 1 : -1);
      secondary[i] = { ...slotDef, at: [at.x, at.y] };
    });
  }
  const line = (dropLine ? [] : front.dl).map((s) => ({ label: s.label, at: mirrorX(s.at, strength) }));
  // Backers and DBs go through the alignment rules; the line never moves.
  const movable: AlignDefender[] = [
    ...front.lb.map((s) => {
      const [x, y] = mirrorX(s.at, strength);
      return { label: s.label, x, y, group: "lb" as const };
    }),
    ...secondary.map((s) => ({ label: s.label, x: s.at[0], y: s.at[1], group: "db" as const })),
  ];
  const aligned = alignDefense({
    skill: skill.map(({ label, at: [x, y] }) => ({ label, x, y })),
    defenders: movable,
    strongDir: strongDir > 0 ? 1 : -1,
    style: call?.coverageStyle ?? coverageStyleFor(coverage),
    table: alignment,
  });
  // The play's safety depth: FS and SS keep their spot across, move up or back.
  const all = [
    ...line,
    ...aligned.defenders.map((d) => {
      const depth = safetyDepthFor(call, d.label);
      return { label: d.label, at: [d.x, depth != null ? safetyY(depth) : d.y] as Pt };
    }),
  ];
  // Ids count per label ("C1", "C2"). Line labels (E/T/N) never repeat among the
  // backers or DBs, so dropping the line in 7v7 doesn't renumber anyone.
  const seen: Record<string, number> = {};
  const defenders = all.map(({ label, at }) => {
    seen[label] = (seen[label] ?? 0) + 1;
    const id = `${label}${seen[label]}`;
    const moved = overrides[id];
    return { id, label, x: moved?.x ?? at[0], y: moved?.y ?? at[1] };
  });
  return { defenders, notes: aligned.notes };
}

/* -------------------------------------------------------------------------- */
/*                               Play reading                                 */
/* -------------------------------------------------------------------------- */

/** How a play is drawn: run blocking, a pass with routes, or a run/pass mix. */
export type PlayKind = "run" | "pass" | "rpo" | "pa" | "none";

export type RunScheme = "zone" | "outside-zone" | "power" | "counter" | "iso" | "draw" | "sneak";

export type RouteKind =
  // The route tree, 0-9.
  | "slide"
  | "speed-out"
  | "slant"
  | "out"
  | "curl"
  | "comeback"
  | "shallow"
  | "corner"
  | "post"
  | "fade"
  // Off the tree: called out by name on the card.
  | "go"
  | "hitch"
  | "dig"
  | "wheel"
  | "flat"
  | "swing"
  | "whip"
  | "bubble"
  | "leak";

/** The staff's route tree: 0 slide, 1 speed out, 2 slant … 9 fade. */
export const ROUTE_TREE: RouteKind[] = [
  "slide",
  "speed-out",
  "slant",
  "out",
  "curl",
  "comeback",
  "shallow",
  "corner",
  "post",
  "fade",
];

const ROUTE_NAMES: Record<RouteKind, string> = {
  slide: "Slide",
  "speed-out": "Speed out",
  slant: "Slant",
  out: "Out",
  curl: "Curl",
  comeback: "Comeback",
  shallow: "Shallow",
  corner: "Corner",
  post: "Post",
  fade: "Fade",
  go: "Go",
  hitch: "Hitch",
  dig: "Dig",
  wheel: "Wheel",
  flat: "Flat",
  swing: "Swing",
  whip: "Whip",
  bubble: "Bubble",
  leak: "Leak",
};

/** Assignment-table text for a route: "9 Fade", or the name off the tree ("Wheel"). */
export function routeText(kind: RouteKind): string {
  const n = ROUTE_TREE.indexOf(kind);
  return n >= 0 ? `${n} ${ROUTE_NAMES[kind]}` : ROUTE_NAMES[kind];
}

/** What the card writes at the end of a route: its tree number, or its name. */
export function routeLabel(kind: RouteKind): string {
  const n = ROUTE_TREE.indexOf(kind);
  return n >= 0 ? String(n) : kind.toUpperCase();
}

/** The route kind a printed arrow label names ("2" → slant, "WHEEL" → wheel), else null. */
export function routeKindForLabel(label: string): RouteKind | null {
  return (Object.keys(ROUTE_NAMES) as RouteKind[]).find((k) => routeLabel(k) === label) ?? null;
}

export const PLAY_KIND_LABELS: Record<PlayKind, string> = {
  run: "RUN",
  pass: "PASS",
  rpo: "RPO",
  pa: "PLAY ACTION",
  none: "—",
};

/** Normalized " WORD WORD " form so keyword tests match whole words only. */
function words(text: string): string {
  return ` ${text
    .toUpperCase()
    .replace(/[^A-Z0-9#]+/g, " ")
    .trim()} `;
}

const ROUTE_WORDS: [RegExp, RouteKind][] = [
  [/^(VERTS?|VERTICALS?|GO|GOES|SEAMS?|STREAKS?|FLY)$/, "go"],
  [/^FADES?$/, "fade"],
  [/^SLANTS?$/, "slant"],
  [/^OUTS?$/, "out"],
  [/^CORNERS?$/, "corner"],
  [/^POSTS?$/, "post"],
  [/^(CURLS?|HOOKS?)$/, "curl"],
  [/^(COMEBACKS?|COMEBACK)$/, "comeback"],
  [/^(HITCH|HITCHES|STICK|STOP)$/, "hitch"],
  [/^(DIGS?|SQUARE)$/, "dig"],
  [/^(WHEELS?|RAILS?)$/, "wheel"],
  [/^(ACROSS|CROSS|CROSSERS?|CROSSING|MESH|SHALLOWS?|DRAGS?)$/, "shallow"],
  [/^SLIDES?$/, "slide"],
  [/^FLATS?$/, "flat"],
  [/^SWING$/, "swing"],
  [/^WHIPS?$/, "whip"],
  [/^(BUBBLE|SCREEN|TUNNEL|NOW)$/, "bubble"],
  [/^LEAK$/, "leak"],
];

/** Words after a number that make it a count ("4 VERTS"), not a route-tree call. */
const COUNT_WORDS = /^(VERTS?|VERTICALS?|GO|GOES|SEAMS?|STREAKS?|WIDE|MAN|BACK|BACKS)$/;

export interface RouteCall {
  tokens: RouteKind[];
  /** True when the call used route-tree numbers ("81", "2 9 6 0"). */
  numbered: boolean;
}

/**
 * Reads the routes out of a play call, in order: route words ("FADE OUT OUT
 * FADE", "SPEED OUT") and route-tree numbers ("81" = 8 then 1).
 */
export function routeCall(playCall: string): RouteCall {
  const ws = words(playCall).trim().split(" ").filter(Boolean);
  const tokens: RouteKind[] = [];
  let numbered = false;
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (/^\d+$/.test(w)) {
      if (COUNT_WORDS.test(ws[i + 1] ?? "")) continue; // "4 VERTS"
      numbered = true;
      for (const digit of w) tokens.push(ROUTE_TREE[Number(digit)]);
      continue;
    }
    if (w === "SPEED" && /^OUTS?$/.test(ws[i + 1] ?? "")) {
      tokens.push("speed-out");
      i++;
      continue;
    }
    const hit = ROUTE_WORDS.find(([re]) => re.test(w));
    if (hit) tokens.push(hit[1]);
  }
  return { tokens, numbered };
}

/** Route kinds in the order they appear in the play call. */
export function routeTokens(playCall: string): RouteKind[] {
  return routeCall(playCall).tokens;
}

const RUN_CONCEPTS = new Set(["inside-zone", "outside-zone", "power", "sweep", "qb-run"]);
const PASS_CONCEPTS = new Set(["verticals", "slant", "screen", "dropback", "boot"]);

export function playKind(card: Pick<HudlPlayCard, "playCall" | "concept">): PlayKind {
  const w = words(card.playCall);
  if (/ RPO /.test(w) || isWingSlideCall(card.playCall)) return "rpo";
  if (/ (PA|PLAY ACTION|BOOT|BOOTLEG|WAGGLE|NAKED) /.test(w)) return "pa";
  if (RUN_CONCEPTS.has(card.concept)) return "run";
  if (routeTokens(card.playCall).length > 0 || PASS_CONCEPTS.has(card.concept)) return "pass";
  return "none";
}

/** Whether a play belongs in 7v7 / pass skeleton: passes, RPOs, and play action. */
export function isPassPlay(card: Pick<HudlPlayCard, "playCall" | "concept">): boolean {
  const kind = playKind(card);
  return kind === "pass" || kind === "rpo" || kind === "pa";
}

/** Practice period on the script page. */
export type Period = "all" | "7v7" | "team";

/**
 * Which plays a practice period lists:
 * - ALL: every play.
 * - TEAM: Scout O gets runs and passes; Scout D gets every look (anything with a
 *   formation or front, even with a blank play call).
 * - 7v7: Scout O gets every pass from team plus untagged plays as formation
 *   reps; Scout D lines up to any formation, so it gets every look too.
 */
export function inPeriod(
  card: Pick<HudlPlayCard, "playCall" | "concept" | "formation" | "defFront" | "routeOverrides">,
  period: Period,
  unit: ScoutUnit,
): boolean {
  if (period === "all") return true;
  if (unit === "defense") return Boolean(card.formation || card.defFront);
  if (period === "7v7") return isPassPlay(card) || playKind(card) === "none";
  // Routes a coach assigned by hand make an untagged play a real pass.
  return playKind(card) !== "none" || hasCoachRoutes(card);
}

/** Route choices a coach can give a letter (Edit play): the tree, then the rest. */
export const ROUTE_CHOICES: { value: string; label: string }[] = [
  ...ROUTE_TREE.map((kind) => ({ value: kind, label: routeText(kind) })),
  ...(["go", "hitch", "dig", "wheel", "flat", "swing", "whip", "bubble", "leak"] as RouteKind[]).map(
    (kind) => ({ value: kind, label: routeText(kind) }),
  ),
  { value: "stalk", label: "Stalk block" },
  { value: "protect", label: "Pass pro" },
  { value: "none", label: "No route" },
];

/** True when a coach (or AI video detection) gave any letter an actual route. */
export function hasCoachRoutes(card: Pick<HudlPlayCard, "routeOverrides">): boolean {
  return Object.values(card.routeOverrides ?? {}).some(
    (o) =>
      (o.path && o.path.length > 0) ||
      (o.route && o.route !== "none" && o.route !== "stalk" && o.route !== "protect"),
  );
}

/** Blocking scheme from play-call keywords ("G ISO" → power, "QB LEAD DRAW" → draw). */
export function runScheme(card: Pick<HudlPlayCard, "playCall" | "concept">): RunScheme {
  const w = words(card.playCall);
  if (/ SNEAK /.test(w)) return "sneak";
  if (/ (COUNTER|TREY|GT|CTR) /.test(w)) return "counter";
  if (/ (POWER|PWR|G) /.test(w)) return "power";
  if (/ DRAW /.test(w)) return "draw";
  if (/ (ISO|LEAD|BELLY|DIVE|WEDGE) /.test(w)) return "iso";
  if (/ (OZ|OUTSIDE|STRETCH|WIDE|SWEEP|TOSS|PITCH|JET|OPTION|SPEED|REVERSE) /.test(w)) {
    return "outside-zone";
  }
  if (card.concept === "power") return "power";
  if (card.concept === "outside-zone" || card.concept === "sweep") return "outside-zone";
  if (card.concept === "qb-run") return "iso";
  return "zone";
}

/* -------------------------------------------------------------------------- */
/*                                 Diagram                                    */
/* -------------------------------------------------------------------------- */

export type DiagramMode = "team" | "7v7";
/** Which scout team the card is for. */
export type ScoutUnit = "offense" | "defense";

export interface Diagram {
  mode: DiagramMode;
  unit: ScoutUnit;
  kind: PlayKind;
  /**
   * The routes actually drawn, by position ("Slant / Flat / Hitch"), when the
   * play call alone doesn't describe the whole play: a one-route call drawn as
   * a combination, or routes from the AI or a coach. The card title uses it
   * instead of the call. Null when the call already says it all (MESH RAIL,
   * 836, VERTS, a run).
   */
  routeSummary: string | null;
  players: Player[];
  /** Ball carrier's path on runs (arrow). */
  carrier: Point[] | null;
  /** Receiver routes (arrows). */
  routes: Point[][];
  /** Label per route (same order): its route-tree number, or its name off the tree. */
  routeLabels: string[];
  /**
   * Player label per route (same order) when that route came from AI video
   * detection (`routeOverrides[label].source === "video"`), else null. Lets
   * `ScoutCard` know which routes to draw draggable correction handles on.
   */
  routeVideoLetters: (string | null)[];
  /**
   * The player each route belongs to (same order), for every route that starts
   * on a skill player or back. Lets a coach drag any arrow's break points
   * (`ScoutCard`'s `adjustRoutes`), not just film or AI routes.
   */
  routeLetters: (string | null)[];
  /**
   * The route-tree / named kind each route draws as, when its label names one
   * ("2" → slant, "WHEEL" → wheel), so an adjusted arrow keeps its number.
   */
  routeKinds: (string | null)[];
  /** Per route (same order): true to draw it as a smooth arc (a bubble) instead of sharp breaks. */
  routeCurves: boolean[];
  /** Scout offense: what each skill player and the QB does ("9 Fade", "Stalk", "Lead"). */
  jobs: Record<string, string>;
  /** Run blocking scheme when the play is a run. */
  scheme: RunScheme | null;
  /** Blocks: a line ending in a T-bar. */
  blocks: Point[][];
  /**
   * Blocks with a named target, drawn with a label at the T-bar: on bubbles and
   * screens the ball-side receivers block the linebacker ("LB") and the
   * safety/corner ("S/C").
   */
  targetBlocks: { path: Point[]; target: string }[];
  /** Pulling linemen (arrows behind the line). */
  pulls: Point[][];
  /** Run fakes on play action / RPO mesh (dashed arrows). */
  fakes: Point[][];
  /** Scout defense cards only: where each defender lines up. */
  defense: Defender[];
  /**
   * Scout defense cards only: what the alignment rules did ("SS apex Y",
   * "S apex H", "FS middle"), shown in the NOTES box until a coach writes one.
   */
  defenseNotes: string[];
  /** X position of the hash the ball is on (null when unknown). */
  ballHashX: number | null;
  /** Y of the line of scrimmage as drawn (moves when the card is flipped). */
  losY: number;
  /** Yard lines as drawn, every 5 yards, with field numbers ("30", "G") every 10. */
  yardLines: { y: number; label: string | null }[];
  /** Y of each 1-yard hash tick as drawn. */
  hashTicks: number[];
  /** How far the formation moved sideways to put the ball on its hash. */
  hashDx: number;
  /**
   * Scout defense cards are turned 180° so the defense is at the bottom, the
   * way the scout defense sees the offense (the offense's right is on their left).
   */
  flipped: boolean;
  /** True when the formation text wasn't recognized and Spread was drawn. */
  formationFallback: boolean;
  /** Scout defense cards only: true when the front wasn't recognized and 4-3 was drawn. */
  frontFallback: boolean;
}

type Placed = Player & { at: Pt };
type LabeledPath = { path: Pt[]; label: string; videoLetter?: string; curve?: boolean };
/** What each skill player does on the play, by label: "9 Fade", "Stalk", "Block LB". */
type Jobs = Record<string, string>;

const clampX = (x: number) => Math.min(488, Math.max(12, x));
const clampY = (y: number) => Math.max(22, y);
const toPoint = ([x, y]: Pt): Point => ({ x: clampX(x), y: clampY(y) });

function mirrorX(p: Pt, side: Side): Pt {
  return side === "left" ? [FIELD.width - p[0], p[1]] : p;
}

function place(slot: Slot, side: Side): Placed {
  const at = mirrorX(slot.at, side);
  const ball = slot.role === "OL" && slot.at[0] === FIELD.center.x;
  return { label: slot.label, role: slot.role, x: at[0], y: at[1], at, ...(ball ? { ball } : {}) };
}

/** Pixels per yard, vertically. 7 keeps deep routes on the card; yard lines use the same scale. */
export const YARD_PX = 7;

/** Screen y for a depth in yards past the line. */
const yd = (yards: number) => FIELD.los - yards * YARD_PX;

/** Where the field numbers sit: about 8 yards in from each sideline, like a real HS field. */
export const NUMBERS_X = { left: 75, right: 425 } as const;

/**
 * Moves the formation so the ball sits on its hash. Players within 70 px of the
 * ball (the line, backs, tight ends, close slots) shift as a unit; wider players
 * keep their room to the sideline, so the short side bunches and the wide side
 * spreads. `dx` is the hash's offset from the middle of the field.
 */
export function mapToHash(x: number, dx: number): number {
  if (dx === 0) return x;
  const [inL, inR, L, R] = [180, 320, 14, 486];
  if (x < inL) return L + ((x - L) * (inL + dx - L)) / (inL - L);
  if (x > inR) return inR + dx + ((x - inR) * (R - inR - dx)) / (R - inR);
  return x + dx;
}

/** Inverse of `mapToHash`: a point on the card back to the formation's own coordinates. */
export function unmapFromHash(x: number, dx: number): number {
  if (dx === 0) return x;
  const [inL, inR, L, R] = [180, 320, 14, 486];
  if (x < inL + dx) return L + ((x - L) * (inL - L)) / (inL + dx - L);
  if (x > inR + dx) return inR + ((x - inR - dx) * (R - inR)) / (R - inR - dx);
  return x - dx;
}

/** Yards from the line of scrimmage to the goal line the offense is attacking. */
function yardsToGoal(yardLine: number | null): number {
  if (yardLine == null) return 70; // unknown: assume the offense's own 30
  if (yardLine < 0) return 100 + yardLine; // own territory (-35 → 65 to go)
  return yardLine; // opponent territory or the 50
}

/** Yard lines every 5 yards (true to the ball's spot), with field numbers every 10. */
function fieldMarkings(yardLine: number | null): {
  yardLines: { y: number; label: string | null }[];
  hashTicks: number[];
} {
  const toGo = yardsToGoal(yardLine);
  const yFor = (g: number) => FIELD.los - (toGo - g) * YARD_PX;
  const yardLines: { y: number; label: string | null }[] = [];
  const hashTicks: number[] = [];
  for (let g = 0; g <= 100; g++) {
    const y = yFor(g);
    if (y < 0 || y > FIELD.height) continue;
    if (g % 5 === 0) {
      const label =
        g === 0 || g === 100 ? "G" : g % 10 === 0 ? String(g <= 50 ? g : 100 - g) : null;
      yardLines.push({ y, label });
    } else {
      hashTicks.push(y);
    }
  }
  return { yardLines, hashTicks };
}

/** Horizontal pixels per yard (the field is 53⅓ yards wide). */
/** Pixels per yard, across the field (53⅓ yards sideline to sideline). */
export const YARD_X = FIELD.width / (160 / 3);
/** A break of `yards` at 45° on the field (x and y scales differ on the card). */
const diag = (yards: number) => [yards * YARD_X, yards * YARD_PX] as const;
/** Just inside the sideline on this receiver's side. */
const sideline = (o: number) => (o > 0 ? FIELD.width - 18 : 18);

/**
 * Route shape for one receiver: straight stems with sharp breaks.
 * `o` = +1 toward the right sideline for this player, -1 left; `d` = play side.
 */
function routePath(kind: RouteKind, p: Pt, o: number, d: number): Pt[] {
  const [x, y] = p;
  const inside = -o;
  switch (kind) {
    case "slide": // 0: release toward the sideline, build up to 5 and settle
      return [p, [x + o * 20, yd(3)], [x + o * 64, yd(5)]];
    case "speed-out": // 1: cut out at 5
      return [p, [x, yd(4)], [x + o * 10, yd(5)], [x + o * 50, yd(5)]];
    case "slant": {
      // 2: three hard steps and plant — quick 3-yard stem, sharp break inside
      const [bx, by] = diag(6);
      return [p, [x, yd(3)], [x + inside * bx, yd(3) - by]];
    }
    case "out": // 3: stem to 10, 90° break to the sideline
      return [p, [x, yd(10)], [sideline(o), yd(10)]];
    case "curl": // 4: stem to 12, back down to 10
      return [p, [x, yd(12)], [x + inside * 10, yd(10)]];
    case "comeback": // 5: stem to 16, back down to 14
      return [p, [x, yd(16)], [x + o * 14, yd(14)]];
    case "shallow": // 6: build up to 5 and cross the field underneath
      return [p, [x, yd(5)], [x + inside * 160, yd(5)]];
    case "corner": {
      // 7: stem to 10, 45° break toward the pylon
      const [bx, by] = diag(6);
      return [p, [x, yd(10)], [x + o * bx, yd(10) - by]];
    }
    case "post": {
      // 8: stem to 10, 45° break toward the goalpost (middle of the field)
      const [bx, by] = diag(6);
      return [p, [x, yd(10)], [x + inside * bx, yd(10) - by]];
    }
    case "fade": // 9: vertical with a slight outside release
      return [p, [x, yd(3)], [x + o * 1.5 * YARD_X, yd(17)]];
    case "go":
      return [p, [x, yd(17)]];
    case "hitch":
      return [p, [x, yd(5)], [x + inside * 6, yd(4)]];
    case "dig":
      return [p, [x, yd(10)], [x + inside * 70, yd(10)]];
    case "wheel":
      return [p, [x + o * 30, y + 4], [x + o * 48, 118], [x + o * 48, yd(15)]];
    case "flat": // out under #1 to the sideline, 1-2 yards deep
      return [p, [x + o * 18, yd(1)], [sideline(o), yd(2)]];
    case "swing":
      return [p, [x + d * 34, y + 6], [x + d * 76, y - 12]];
    case "whip": {
      // A slant (three hard steps, then 45° inside), then back out to the flat.
      const [bx, by] = diag(3);
      const outTo = x + o * 6 * YARD_X;
      return [p, [x, yd(3)], [x + inside * bx, yd(3) - by], [o > 0 ? Math.min(outTo, sideline(o)) : Math.max(outTo, sideline(o)), yd(2)]];
    }
    case "bubble": {
      // Away from the ball, never back toward the Q: a drop step back and out,
      // then flatten toward the sideline, still behind the line for the catch.
      // Drawn as a smooth arc (`Diagram.routeCurves`); a receiver already split
      // wide gets a shorter arc that stays on the field.
      const out = Math.min(1, Math.max(0.2, ((sideline(o) - x) * o) / (7 * YARD_X)));
      const at = (yards: number, back: number): Pt => [x + o * yards * YARD_X * out, y + back * YARD_PX];
      // Deep enough (2.5 yards back) to pass behind the receivers blocking for it.
      return [p, at(1.5, 1.5), at(4, 2.5), at(7, 2.5)];
    }
    case "leak":
      return [p, [x, 132], [x + inside * 50, 120], [x + inside * 150, 108]];
  }
}

/**
 * A concept route that isn't on the tree (drag, rail, sail, deep dig), from
 * its yard vector: stem up to `stemY` (leaning `driftIn` yards inside), then to
 * `breakX` yards across at `breakY` deep. Rails go out to the flat, then straight up the field
 * `fromSideline` yards in from that sideline.
 */
function conceptPath(route: ConceptRoute, pl: Placed, o: number, d: number): Pt[] {
  const [x, y] = pl.at;
  const dir =
    route.toward === "inside" ? -o : route.toward === "playside" ? d : route.toward === "backside" ? -d : o;
  const stem = route.stemY ?? 0;
  if (route.vertical) {
    const railX = dir > 0 ? FIELD.width - (route.fromSideline ?? 8) * YARD_X : (route.fromSideline ?? 8) * YARD_X;
    // Step up between the Q and the line first, so a back crossing the formation clears the Q.
    const release: Pt = y > FIELD.los + 31 ? [x + dir * 6, FIELD.los + 31] : [x + (railX - x) * 0.3, y - 18];
    return [pl.at, release, [railX, yd(stem)], [railX, yd(route.breakY ?? 16)]];
  }
  const endX = Math.min(FIELD.width - 12, Math.max(12, x + dir * (route.breakX ?? 0) * YARD_X));
  const path: Pt[] = [pl.at];
  // The stem can lean inside (the sail), so the break back out to the sideline has room.
  if (stem > 0) path.push([x - o * (route.driftIn ?? 0) * YARD_X, yd(stem)]);
  path.push([endX, yd(route.breakY ?? stem)]);
  return path;
}

/**
 * A lone route word as a route combination, per side outside in: [#1, #2, #3].
 * The called route goes to the #1s unless it's an inside route (a shallow or a
 * flat belongs to #2, with #1 clearing). Verticals ("GO", "VERTS") aren't
 * here: those really are everyone.
 */
export const ROUTE_COMBOS: Partial<Record<RouteKind, RouteKind[]>> = {
  slant: ["slant", "flat", "hitch"],
  "speed-out": ["speed-out", "go", "hitch"],
  out: ["out", "go", "flat"],
  curl: ["curl", "flat", "go"],
  comeback: ["comeback", "flat", "go"],
  corner: ["corner", "flat", "go"],
  post: ["post", "dig", "flat"],
  fade: ["fade", "flat", "hitch"],
  hitch: ["hitch", "go", "flat"],
  dig: ["dig", "go", "flat"],
  shallow: ["go", "shallow", "hitch"],
  flat: ["go", "flat", "hitch"],
  whip: ["go", "whip", "hitch"],
};

/**
 * Which letter holds each concept position (see conceptMapper.ts) for this
 * card's formation and play side: play-side / backside #1-#3 outside in, and
 * the back. How the AI import review turns "ps1 slant" into "Z runs a slant".
 */
export function routeSlots(
  card: Pick<HudlPlayCard, "formationKey" | "formationSide" | "playDirection">,
): Partial<Record<ConceptSlot, string>> {
  const shape = FORMATIONS[card.formationKey === "unknown" ? "spread" : card.formationKey];
  const d = card.playDirection === "right" ? 1 : -1;
  const skill = shape.skill.map((s) => place(s, card.formationSide));
  const backs = shape.backs.map((s) => place(s, card.formationSide));
  const sideOf = (x: number) => (x > 250 ? 1 : x < 250 ? -1 : d);
  const outsideIn = (list: Placed[]) => list.sort((a, b) => Math.abs(b.x - 250) - Math.abs(a.x - 250));
  const ps = outsideIn(skill.filter((p) => sideOf(p.x) === d));
  const bs = outsideIn(skill.filter((p) => sideOf(p.x) !== d));
  const slots: Partial<Record<ConceptSlot, string>> = {};
  const set = (slot: ConceptSlot, p: Placed | undefined) => {
    if (p) slots[slot] = p.label;
  };
  set("ps1", ps[0]);
  set("ps2", ps[1]);
  set("ps3", ps[2]);
  set("bs1", bs[0]);
  set("bs2", bs[1]);
  set("back", backs[0]);
  return slots;
}

/** Jobs that aren't a route to name in a title. */
const NOT_A_ROUTE = /^(Pass pro|Stalk|Route|WING · Route|Crack|—|Block|Hand off|Ball carrier|Mesh:|Read:|Run fake)/i;

/** See `Diagram.routeSummary`. */
function summarizeRoutes(
  card: Pick<HudlPlayCard, "playCall" | "routeOverrides" | "formationKey" | "formationSide" | "playDirection">,
  kind: PlayKind,
  jobs: Jobs,
): string | null {
  if (kind !== "pass" && kind !== "pa" && kind !== "rpo") return null;
  const { tokens, numbered } = routeCall(card.playCall);
  const distinct = new Set(tokens);
  const thinCall =
    !numbered &&
    !matchConcept(card.playCall) &&
    !isWingSlideCall(card.playCall) &&
    distinct.size <= 1 &&
    ![...distinct].some((t) => ["go", "bubble", "leak", "wheel", "swing"].includes(t));
  const ownRoutes = Object.values(card.routeOverrides ?? {}).some((o) => o.route || o.path?.length);
  if (!thinCall && !ownRoutes) return null;
  const slots = routeSlots(card);
  const names: string[] = [];
  for (const slot of ["ps1", "ps2", "ps3", "bs1", "bs2", "back"] as ConceptSlot[]) {
    const job = slots[slot] ? jobs[slots[slot]!] : undefined;
    if (!job || NOT_A_ROUTE.test(job)) continue;
    const name = job.replace(/^\d+\s+/, "").split("·")[0].trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names.length >= 2 ? names.join(" / ") : null;
}

/**
 * A route as the staff draws it, in yards from the player's own spot: x toward his sideline
 * (`outside`, +1 for the right sideline, -1 for the left, mirrored so "outside" is always
 * positive when `outside` is +1), y upfield. The reference shape the route reader
 * (`routeReader.ts`) compares a path from film against.
 */
export function routeTemplateYards(kind: RouteKind, outside: 1 | -1 = 1): [number, number][] {
  // A receiver off the line, a little outside the numbers, so sideline-bound breaks have room.
  const start: Pt = [FIELD.center.x + outside * 130, FIELD.los + 10];
  return routePath(kind, start, outside, outside).map(
    ([x, y]) => [((x - start[0]) / YARD_X) * outside, (start[1] - y) / YARD_PX] as [number, number],
  );
}

/**
 * A named route's shape for one letter on this card, as deltas from his own
 * spot (the `RouteOverride.path` form): how a film route the AI named
 * ("SLIDE") is drawn exactly like the route tree, from wherever that player
 * lines up on this card. Null if the card has no such letter.
 */
export function namedRouteDeltas(
  card: Pick<HudlPlayCard, "formationKey" | "formationSide" | "playDirection" | "playCall"> &
    Partial<Pick<HudlPlayCard, "formation" | "offenseSpots">>,
  letter: string,
  kind: RouteKind,
): [number, number][] | null {
  const shape = FORMATIONS[card.formationKey === "unknown" ? "spread" : card.formationKey];
  const d = card.playDirection === "right" ? 1 : -1;
  const side = card.formationSide;
  const { qb, backs, skill } = alignOffense(
    card,
    place({ label: "Q", role: "QB", at: shape.qb }, side),
    shape.backs.map((s) => place(s, side)),
    shape.skill.map((s) => place(s, side)),
    d,
  );
  const pl = [qb, ...backs, ...skill].find((p) => p.label === letter);
  if (!pl) return null;
  const o = pl.x > 250 ? 1 : pl.x < 250 ? -1 : d;
  return routePath(kind, pl.at, o, d)
    .slice(1)
    .map(([x, y]) => [x - pl.x, y - pl.y]);
}

/**
 * Letters that line up as a WING on this card (either side): the alignment
 * check walked inside out from the tackle, on the card's real spots (film,
 * WING tags). Film calls a wing's release to the flat a SLIDE, never a bubble.
 */
export function wingLetters(
  card: Pick<HudlPlayCard, "formationKey" | "formationSide" | "playDirection" | "playCall"> &
    Partial<Pick<HudlPlayCard, "formation" | "offenseSpots">>,
): Set<string> {
  const shape = FORMATIONS[card.formationKey === "unknown" ? "spread" : card.formationKey];
  const side = card.formationSide;
  const { skill } = alignOffense(
    card,
    place({ label: "Q", role: "QB", at: shape.qb }, side),
    shape.backs.map((s) => place(s, side)),
    shape.skill.map((s) => place(s, side)),
    card.playDirection === "right" ? 1 : -1,
  );
  const wings = new Set<string>();
  for (const dir of [-1, 1]) {
    const fromBall = (p: Placed) => (p.x - FIELD.center.x) * dir;
    let edge = TACKLE_DX;
    for (const p of skill.filter((q) => fromBall(q) > 0).sort((a, b) => fromBall(a) - fromBall(b))) {
      const alignment = insideAlignment((fromBall(p) - edge) / YARD_X, p.y > 150);
      if (alignment === "slot") break;
      if (alignment === "wing") wings.add(p.label);
      edge = fromBall(p);
    }
  }
  return wings;
}

const moveTo = (p: Placed, x: number, y: number): Placed => ({ ...p, x, y, at: [x, y] });

/** Pixels from the ball to the tackle's center: the box edge before any tight end. */
const TACKLE_DX = 44;

/**
 * Where the offense lines up when it isn't the formation's standard shape:
 *
 * 1. **Film spots** (`card.offenseSpots`, yards from the ball): every
 *    detected letter goes where he really stood. A receiver within about half a
 *    yard of the line is on it; nobody is put on top of a lineman.
 * 2. **A WING tag** in the formation ("ACE WING", strength side) or the call
 *    ("WING SLIDE", play side): unless film already placed him, the inside
 *    receiver on that side moves in to a wing, two yards outside the box edge
 *    (the tackle, or a tight end attached to him) and just off the line.
 */
function alignOffense(
  card: Pick<HudlPlayCard, "playCall" | "formationSide"> & Partial<Pick<HudlPlayCard, "offenseSpots" | "formation">>,
  qb: Placed,
  backs: Placed[],
  skill: Placed[],
  d: number,
): { qb: Placed; backs: Placed[]; skill: Placed[] } {
  const spots = card.offenseSpots ?? {};
  const fromFilm = (p: Placed): Placed => {
    const spot = spots[p.label];
    if (!spot || !Number.isFinite(spot.x) || !Number.isFinite(spot.y)) return p;
    let x = Math.min(FIELD.width - 14, Math.max(14, FIELD.center.x + spot.x * YARD_X));
    if (p.role === "QB" || p.role === "RB" || p.role === "FB") {
      const lo = p.role === "QB" ? 166 : 160;
      return moveTo(p, x, Math.min(240, Math.max(lo, FIELD.los - spot.y * YARD_PX)));
    }
    const onLine = spot.y > -0.6; // off-ball receivers stand about a yard back
    // Outside the tackle: on the line a tight end's width, off it far enough to clear him.
    const minDx = onLine ? TACKLE_DX + 22 : TACKLE_DX + 16;
    const dx = x - FIELD.center.x;
    if (Math.abs(dx) < minDx) x = FIELD.center.x + (dx < 0 ? -1 : 1) * minDx;
    return moveTo(p, x, onLine ? 150 : Math.min(200, Math.max(160, FIELD.los - spot.y * YARD_PX)));
  };
  const out = { qb: fromFilm(qb), backs: backs.map(fromFilm), skill: skill.map(fromFilm) };
  // Seven on the line: on each side only the widest receiver the film put on it stays there;
  // anyone inside him who also read as "on the line" is off the ball (he'd be covered up).
  for (const dir of [-1, 1]) {
    const onLine = out.skill
      .filter((p) => spots[p.label] && p.y === 150 && (p.x - FIELD.center.x) * dir > 0)
      .sort((a, b) => (b.x - a.x) * dir);
    for (const p of onLine.slice(1)) out.skill = out.skill.map((q) => (q === p ? moveTo(p, p.x, 160) : q));
  }

  const ws = callWords(card.formation ?? "");
  const formationWing = ws.includes("WING");
  const callWing = callWords(card.playCall).includes("WING") && isWingSlideCall(card.playCall);
  if (!formationWing && !callWing) return out;
  const dir = formationWing ? (card.formationSide === "left" ? -1 : 1) : d;
  const fromBall = (p: Placed) => (p.x - FIELD.center.x) * dir;
  const mine = out.skill.filter((p) => fromBall(p) > 0).sort((a, b) => fromBall(a) - fromBall(b));
  let edge = TACKLE_DX;
  for (const p of mine) {
    const alignment = insideAlignment((fromBall(p) - edge) / YARD_X, p.y > 150);
    if (alignment === "wing") return out; // already a wing
    if (alignment === "tight-end") {
      edge = fromBall(p);
      continue;
    }
    if (spots[p.label] || p.role !== "WR") return out; // film says where he was; trust it
    const wing = moveTo(p, FIELD.center.x + dir * (edge + 2 * YARD_X), 162);
    out.skill = out.skill.map((q) => (q === p ? wing : q));
    return out;
  }
  return out;
}

/**
 * The wing slide RPO's receivers (see conceptMapper.ts). The alignment check
 * walks the play side inside out from the tackle like the Scout D rules do: a
 * player within three yards of the box edge is on the box (a tight end on the
 * line, a WING off it) and moves the edge out to him. The slider is the wing
 * if there is one, else the play side's innermost receiver (#3 in trips, the
 * slot in 2x2, the tight end in Pro). Receivers outside him block for it,
 * inside out: crack the alley, then stalk the corner. The backside stalks.
 */
function wingSlide(
  receivers: Placed[],
  d: number,
  side: (x: number) => number,
  out: { routes: LabeledPath[]; targeted: { path: Pt[]; target: string }[]; stalks: Pt[][]; jobs: Jobs },
): void {
  const fromBall = (p: Placed) => Math.abs(p.x - 250);
  const byDistance = (list: Placed[]) => list.sort((a, b) => fromBall(a) - fromBall(b));
  const playSide = byDistance(receivers.filter((p) => side(p.x) === d));
  const ownSide = playSide.length > 0 ? playSide : byDistance(receivers.filter((p) => side(p.x) !== d));
  let edge = TACKLE_DX;
  const aligned = ownSide.map((p) => {
    const alignment = insideAlignment((fromBall(p) - edge) / YARD_X, p.y > 150);
    if (alignment !== "slot") edge = Math.max(edge, fromBall(p));
    return { p, alignment };
  });
  const slider = aligned.find((a) => a.alignment === "wing") ?? aligned[0];
  if (!slider) return;

  const { p, alignment } = slider;
  const o = side(p.x);
  const [x] = p.at;
  const outside = ownSide.filter((r) => r !== p && fromBall(r) > fromBall(p));
  // The catch is in the flat inside the next receiver out, never through him
  // (at least 3 yards of slide), else out toward the sideline.
  const room = outside[0] ? Math.max(3 * YARD_X, Math.abs(outside[0].x - x) - 20) : Math.abs(sideline(o) - x);
  const farthest = SLIDE_PATH[SLIDE_PATH.length - 1].across * YARD_X;
  const scale = Math.min(1, room / farthest);
  out.routes.push({
    path: [p.at, ...SLIDE_PATH.map(({ across: a, behind: b }) => [x + o * a * YARD_X * scale, FIELD.los + b * YARD_PX] as Pt)],
    label: "SLIDE",
  });
  out.jobs[p.label] = alignment === "wing" ? "WING: slide to the flat" : "Slide to the flat";

  // Outside him, inside out: crack the alley, stalk the corner, then plain stalks.
  outside.forEach((r, i) => {
    const block = SLIDE_BLOCKS[i];
    const [bx] = r.at;
    if (!block) {
      out.stalks.push([r.at, [bx, 124]]);
      out.jobs[r.label] = "Stalk";
      return;
    }
    const ro = side(bx);
    const path: Pt[] =
      i === 0
        ? [r.at, [bx - ro * YARD_X, yd(1)], [bx - ro * block.inside * YARD_X, yd(block.up)]] // crack: flat down inside
        : [r.at, [bx, yd(2)], [bx - ro * block.inside * YARD_X, yd(block.up)]]; // stalk: up, then inside
    out.targeted.push({ path, target: block.target });
    out.jobs[r.label] = block.job;
  });
  // The backside receivers stalk; a backside tight end blocks with the line.
  for (const r of receivers) {
    if (r === p || outside.includes(r) || r.role !== "WR") continue;
    out.stalks.push([r.at, [r.x, 124]]);
    out.jobs[r.label] = "Stalk";
  }
}

/** Receiver routes for a pass, RPO, or play-action call. */
function buildRoutes(
  playCall: string,
  skill: Placed[],
  backs: Placed[],
  d: number,
): {
  routes: LabeledPath[];
  stalks: Pt[][];
  targeted: { path: Pt[]; target: string }[];
  jobs: Jobs;
} {
  const side = (x: number) => (x > 250 ? 1 : x < 250 ? -1 : d);
  const { tokens, numbered } = routeCall(playCall);
  const routes: LabeledPath[] = [];
  const stalks: Pt[][] = [];
  const targeted: { path: Pt[]; target: string }[] = [];
  const jobs: Jobs = {};
  const assigned = new Set<Placed>();
  const run = (pl: Placed, kind: RouteKind) => {
    routes.push({ path: routePath(kind, pl.at, side(pl.x), d), label: routeLabel(kind), curve: kind === "bubble" });
    jobs[pl.label] = routeText(kind);
    assigned.add(pl);
  };

  // LEAK belongs to a tight end (or the back when there isn't one).
  const leaks = tokens.filter((t) => t === "leak").length;
  let others = tokens.filter((t) => t !== "leak");
  const leaker = skill.find((p) => p.role === "TE") ?? backs[backs.length - 1];
  if (leaks > 0 && leaker) run(leaker, "leak");

  // Wing slide RPO ("RPO SLIDE", "WING FLAT"): the inside receiver slides to
  // the flat under his outside receivers' crack / stalk blocks.
  if (isWingSlideCall(playCall)) {
    wingSlide(skill.filter((p) => !assigned.has(p)), d, side, { routes, targeted, stalks, jobs });
    return { routes, stalks, targeted, jobs };
  }

  // A named concept ("MESH RAIL", "SMASH"): a distinct route per position
  // from src/lib/conceptMapper.ts. Tree numbers always read as numbers.
  const concept = numbered ? null : matchConcept(playCall);
  const extra = concept ? routeCall(concept.otherWords.join(" ")).tokens.filter((t) => t !== "leak") : [];
  if (concept && !(concept.concept.exclusive && extra.length > 0)) {
    const eligible = skill.filter((p) => !assigned.has(p));
    const outsideIn = (list: Placed[]) => list.sort((a, b) => Math.abs(b.x - 250) - Math.abs(a.x - 250));
    const ps = outsideIn(eligible.filter((p) => side(p.x) === d));
    const bs = outsideIn(eligible.filter((p) => side(p.x) !== d));
    const slots: Record<ConceptSlot, Placed | undefined> = {
      ps1: ps[0],
      ps2: ps[1],
      ps3: ps[2],
      bs1: bs[0],
      bs2: bs[1],
      back: backs.find((b) => !assigned.has(b)),
    };
    for (const { who, route } of concept.concept.routes) {
      const pl = who.map((slot) => slots[slot]).find((p) => p && !assigned.has(p));
      if (!pl) continue;
      // Another route word in the call ("MESH GO") goes to the outside receivers.
      const own = extra[0] && (pl === slots.ps1 || pl === slots.bs1) ? extra[0] : null;
      if (own) {
        run(pl, own);
        continue;
      }
      if (route.tree) {
        routes.push({ path: routePath(route.tree, pl.at, side(pl.x), d), label: routeLabel(route.tree) });
      } else {
        routes.push({ path: conceptPath(route, pl, side(pl.x), d), label: route.type });
      }
      jobs[pl.label] = route.job;
      assigned.add(pl);
    }
    // The back's own tag on top of the concept ("MESH RAIL").
    const back = concept.backTag ? slots.back : undefined;
    if (concept.backTag && back && !assigned.has(back)) {
      routes.push({ path: conceptPath(concept.backTag, back, side(back.x), d), label: concept.backTag.type });
      jobs[back.label] = concept.backTag.job;
      assigned.add(back);
    }
    // Anyone the concept doesn't name (a trips #3, say) clears vertically.
    for (const p of eligible) if (!assigned.has(p) && p.role !== "RB" && p.role !== "FB") run(p, "go");
    return { routes, stalks, targeted, jobs };
  }

  // RAIL is always the back's route; WHEEL is too when it's the only route
  // word. Otherwise WHEEL reads left to right like any other word
  // ("SLANT CORNER WHEEL ACROSS").
  const rail = / RAILS? /.test(words(playCall));
  const backWheel = !numbered && others.includes("wheel") && (rail || others.length === 1);
  const railer = backs.find((b) => !assigned.has(b));
  if (backWheel && railer) {
    const route: ConceptRoute = {
      type: rail ? "RAIL" : "WHEEL",
      stemY: 1,
      breakY: 16,
      toward: "outside",
      vertical: true,
      fromSideline: 8,
      job: rail ? "Rail up the sideline" : "Wheel",
    };
    routes.push({ path: conceptPath(route, railer, side(railer.x), d), label: route.type });
    jobs[railer.label] = route.job;
    assigned.add(railer);
    others = others.filter((t) => t !== "wheel");
  }

  const receivers = skill.filter((p) => !assigned.has(p)).sort((a, b) => a.x - b.x);
  if (others.length === 1) {
    const [only] = others;
    if (only === "bubble") {
      // Bubble / screen to the play-side slot. The other ball-side receivers,
      // inside out, block the linebacker and then the safety/corner; the
      // backside receivers stalk.
      const playSide = receivers
        .filter((p) => p.role === "WR" && side(p.x) === d)
        .sort((a, b) => Math.abs(a.x - 250) - Math.abs(b.x - 250));
      const [slot, ...blockers] = playSide;
      if (slot) run(slot, "bubble");
      blockers.forEach((p, i) => {
        const o = side(p.x);
        const [x] = p.at;
        if (blockers.length >= 2 && i === 0) {
          targeted.push({ path: [p.at, [x, 132], [x - o * 34, 106]], target: "LB" }); // up, then inside
        } else if (blockers.length >= 2 && i === 1) {
          targeted.push({ path: [p.at, [x, 122], [x - o * 12, 92]], target: "S/C" }); // up and in, deep
        } else {
          targeted.push({ path: [p.at, [x, 114]], target: "C" }); // lone blocker: the corner
        }
        jobs[p.label] = `Block ${targeted[targeted.length - 1].target}`;
        assigned.add(p);
      });
      for (const p of receivers) {
        if (!assigned.has(p) && p.role === "WR") {
          stalks.push([p.at, [p.x, 124]]);
          jobs[p.label] = "Stalk";
        }
      }
    } else if (!numbered && ROUTE_COMBOS[only]) {
      // One route word ("QUICK SLANT", "CURL"): a combination, not the same
      // route for everyone. Each side, outside in, the wide receivers #1 / #2 /
      // #3 run the combo's routes (slant / flat / sit for SLANT), mirrored on
      // the backside. A lone tree number ("2") still means everyone runs it.
      // Tight ends stay in to protect, as before.
      const combo = ROUTE_COMBOS[only]!;
      const wideOuts = receivers.filter((p) => p.role === "WR");
      for (const list of [wideOuts.filter((p) => side(p.x) > 0), wideOuts.filter((p) => side(p.x) < 0)]) {
        list
          .sort((a, b) => Math.abs(b.x - 250) - Math.abs(a.x - 250))
          .forEach((p, i) => run(p, combo[Math.min(i, combo.length - 1)]));
      }
    } else {
      // "VERTS", "GO": every wide receiver runs it (TEs too on verticals).
      for (const p of receivers) {
        if (p.role === "WR" || only === "go") run(p, only);
      }
    }
  } else if (numbered && others.length < receivers.length) {
    // Route-tree numbers, fewer than receivers ("81"): the same on both sides,
    // outside in: #1 runs the first number, #2 the second, #3 the third.
    const right = receivers.filter((p) => p.x > 250).sort((a, b) => b.x - a.x);
    const left = receivers.filter((p) => p.x < 250).sort((a, b) => a.x - b.x);
    for (const sideList of [right, left]) {
      others.slice(0, sideList.length).forEach((kind, i) => run(sideList[i], kind));
    }
  } else if (numbered) {
    // One number per receiver ("2960"): read right to left across the formation.
    const eligible = (
      others.length > receivers.length
        ? [...receivers, ...backs.filter((b) => !assigned.has(b))]
        : receivers
    ).sort((a, b) => b.x - a.x);
    others.slice(0, eligible.length).forEach((kind, i) => run(eligible[i], kind));
  } else if (others.length > 1) {
    // Several route words read left to right across the formation ("FADE OUT OUT FADE").
    const eligible =
      others.length > receivers.length
        ? [...receivers, ...backs.filter((b) => !assigned.has(b))].sort((a, b) => a.x - b.x)
        : receivers;
    others.slice(0, eligible.length).forEach((kind, i) => run(eligible[i], kind));
  }
  return { routes, stalks, targeted, jobs };
}

/** Offensive line (and tight end / fullback) assignments for a run scheme. */
function buildBlocking(
  scheme: RunScheme,
  line: Placed[],
  backs: Placed[],
  carrier: Placed | undefined,
  d: number,
  qbY = 190,
): { blocks: Pt[][]; pulls: Pt[][] } {
  const at = (dx: number, y: number): Pt => [250 + d * dx, y];
  // Pullers run flat behind the line: in front of a gun QB, just under an
  // under-center QB. Two pullers get separate lanes so their paths never merge.
  const underCenter = qbY < 180;
  const lane1 = underCenter ? 178 : 163;
  const lane2 = underCenter ? 186 : 173;
  const blocks: Pt[][] = [];
  const pulls: Pt[][] = [];
  // r > 0 is frontside (the side the play goes), r < 0 backside, 0 = center.
  const r = (p: Placed) => (p.x - 250) * d;
  const backsideGuard = line.filter((p) => r(p) < 0).sort((a, b) => r(b) - r(a))[0];
  const backsideTackle = line
    .filter((p) => r(p) < 0 && p !== backsideGuard)
    .sort((a, b) => r(b) - r(a))[0];

  for (const p of line) {
    const [x] = p.at;
    switch (scheme) {
      case "zone":
        blocks.push([p.at, [x + d * 16, 124]]);
        break;
      case "outside-zone":
        blocks.push([p.at, [x + d * 26, 132]]);
        break;
      case "power":
      case "counter":
        if (r(p) >= 0)
          blocks.push([p.at, [x - d * 16, 126]]); // frontside down blocks
        else if (p === backsideGuard)
          pulls.push(
            scheme === "power"
              ? [p.at, [x, lane1], at(44, lane1), at(56, 124)] // wraps up through the hole
              : [p.at, [x, lane1], at(80, lane1), at(96, 138)], // counter: kicks out the end, wide
          );
        else if (p === backsideTackle && scheme === "counter")
          pulls.push([p.at, [x, lane2], at(46, lane2), at(52, 106)]); // counter: tackle wraps inside, up to the LB
        else blocks.push([p.at, [x - d * 12, 160]]); // backside hinge
        break;
      case "iso":
        // Center and guards climb to the linebackers; tackles and TEs base block.
        blocks.push(Math.abs(r(p)) <= 22 ? [p.at, [x, 104]] : [p.at, [x, 128]]);
        break;
      case "draw":
        // Show pass set, then drive the defender past the running lane.
        blocks.push([p.at, [x + (x - 250) * 0.25, 160], [x + (x - 250) * 0.35, 128]]);
        break;
      case "sneak":
        blocks.push([p.at, [x + (250 - x) * 0.3, 128]]); // wedge
        break;
    }
  }

  // Backs who don't carry the ball lead-block.
  for (const b of backs) {
    if (b === carrier) continue;
    if (scheme === "power")
      blocks.push([b.at, at(80, 136)]); // kick out
    else if (scheme === "iso" || scheme === "draw")
      blocks.push([b.at, at(10, 112)]); // lead up the hole
    else if (scheme !== "sneak" && scheme !== "counter") blocks.push([b.at, at(34, 122)]);
  }
  return { blocks, pulls };
}

function carrierPath(scheme: RunScheme, c: Pt, d: number): Pt[] {
  const at = (dx: number, y: number): Pt => [250 + d * dx, y];
  switch (scheme) {
    case "zone":
      return [c, at(12, 150), at(20, 92)];
    case "outside-zone":
      return [c, at(80, c[1] + 4), at(150, 170), at(172, 100)];
    case "power":
      return [c, at(40, 172), at(56, 96)];
    case "counter":
      // Counter step away, cut behind the QB, then follow the pullers outside the tackle's wrap.
      return [c, [c[0] - d * 14, c[1] + 6], [250 + d * 10, c[1] + 20], at(50, 180), at(70, 96)];
    case "iso":
    case "draw":
      return [c, at(8, 150), at(10, 92)];
    case "sneak":
      return [c, at(0, 104)];
  }
}

/**
 * Draws a card. Scout offense: every offensive player plus blocking/routes.
 * Scout defense: the offensive formation (no assignments) plus where the
 * defense aligns. `7v7` drops the linemen on both sides.
 */
export function buildDiagram(
  card: Pick<
    HudlPlayCard,
    | "formationKey"
    | "formationSide"
    | "concept"
    | "playDirection"
    | "hash"
    | "playCall"
    | "frontKey"
    | "defenseOverrides"
    | "secondary"
    | "yardLine"
    | "routeOverrides"
  > &
    Partial<Pick<HudlPlayCard, "coverage" | "defenseAlignment" | "formation" | "offenseSpots">>,
  mode: DiagramMode = "team",
  unit: ScoutUnit = "offense",
): Diagram {
  const formationFallback = card.formationKey === "unknown";
  const shape =
    FORMATIONS[formationFallback ? "spread" : (card.formationKey as keyof typeof FORMATIONS)];
  const side = card.formationSide;
  const d = card.playDirection === "right" ? 1 : -1;
  // Routes a coach assigned by hand make an untagged play a pass.
  let kind = playKind(card);
  if (kind === "none" && unit === "offense" && hasCoachRoutes(card)) kind = "pass";

  const line = OFFENSIVE_LINE.map((s) => place(s, side));
  const { qb, backs, skill } = alignOffense(
    card,
    place({ label: "Q", role: "QB", at: shape.qb }, side),
    shape.backs.map((s) => place(s, side)),
    shape.skill.map((s) => place(s, side)),
    d,
  );
  const tightEndsOnLine = skill.filter((p) => p.role === "TE" && p.y === 150);

  const blocks: Pt[][] = [];
  const targetBlocks: { path: Pt[]; target: string }[] = [];
  const pulls: Pt[][] = [];
  const fakes: Pt[][] = [];
  let routes: LabeledPath[] = [];
  let carrier: Pt[] | null = null;
  let scheme: RunScheme | null = null;
  const jobs: Jobs = {};
  const ballCarrier = card.concept === "qb-run" ? qb : backs[backs.length - 1];

  const frontFallback = unit === "defense" && card.frontKey === "unknown";
  const aligned =
    unit === "defense"
      ? buildDefense(
          frontFallback ? "4-3" : (card.frontKey as Exclude<FrontKey, "unknown">),
          skill.map((p) => ({ label: p.label, at: p.at })),
          side,
          mode === "7v7",
          card.defenseOverrides,
          card.secondary,
          card.coverage,
          card.defenseAlignment,
        )
      : null;
  const defense = aligned?.defenders ?? [];

  if (unit === "defense") {
    // The scout defense only needs the formation it's lining up against.
  } else if (kind === "run") {
    scheme = runScheme(card);
    const blocking = buildBlocking(
      scheme,
      [...line, ...tightEndsOnLine],
      backs,
      ballCarrier,
      d,
      qb.y,
    );
    blocks.push(...blocking.blocks);
    pulls.push(...blocking.pulls);
    carrier = ballCarrier ? carrierPath(scheme, ballCarrier.at, d) : null;
    // Receivers stalk-block the perimeter instead of running routes.
    for (const p of skill) {
      if (p.role === "WR") {
        blocks.push([p.at, [p.x, 124]]);
        jobs[p.label] = "Stalk";
      } else {
        jobs[p.label] = RUN_LINE_JOBS[scheme].PST;
      }
    }
    for (const b of backs) {
      jobs[b.label] =
        b === ballCarrier
          ? "Ball carrier"
          : scheme === "power"
            ? "Kick out the end"
            : scheme === "iso" || scheme === "draw"
              ? "Lead up the hole"
              : scheme === "counter" || scheme === "sneak"
                ? "Fake"
                : "Lead / arc";
    }
    jobs.Q = ballCarrier === qb ? "Ball carrier" : "Hand off";
  } else if (kind !== "none") {
    const passing = buildRoutes(card.playCall, skill, backs, d);
    routes = passing.routes;
    blocks.push(...passing.stalks);
    targetBlocks.push(...passing.targeted);
    Object.assign(jobs, passing.jobs);
    jobs.Q =
      kind === "rpo" ? "Read: give or throw" : kind === "pa" ? "Fake, then throw" : "Drop, throw";
    if (kind !== "rpo" && mode === "team") {
      // Pass protection: short angle-back sets for the line, and any TE or back
      // without a route steps up to protect.
      for (const l of line) blocks.push([l.at, [l.x + (l.x - 250) * 0.2, 162]]);
      for (const p of [...skill, ...backs]) {
        if (jobs[p.label] || (p.role !== "TE" && p.role !== "RB" && p.role !== "FB")) continue;
        const o = p.x >= 250 ? 1 : -1;
        blocks.push(p.y === 150 ? [p.at, [p.x + o * 8, 162]] : [p.at, [p.x + o * 14, p.y - 12]]);
        jobs[p.label] = "Pass pro";
      }
    }
    const rb = backs[backs.length - 1];
    if ((kind === "rpo" || kind === "pa") && rb) {
      // The mesh / run fake: the back's run path, dashed.
      fakes.push([rb.at, [250 + d * 12, 150], [250 + d * 20, 110]]);
      jobs[rb.label] ??= kind === "rpo" ? "Mesh: run it if given" : "Run fake";
      if (kind === "rpo" && mode === "team") {
        // RPO: the line blocks it like a run (zone).
        // A tight end with a route of his own (the slide) isn't in it.
        const zone = buildBlocking("zone", [...line, ...tightEndsOnLine.filter((p) => !passing.jobs[p.label])], [], undefined, d);
        blocks.push(...zone.blocks);
      }
      if (kind === "pa") {
        const boot = / (BOOT|BOOTLEG|NAKED|WAGGLE) /.test(words(card.playCall));
        // QB after the fake: boot away from the fake, or set up in the pocket.
        fakes.push(
          boot
            ? [qb.at, [250 - d * 60, qb.y + 12], [250 - d * 100, 172]]
            : [qb.at, [qb.x, qb.y + 26]],
        );
      }
    }
  }

  // A coach's own routes and tags per letter win over the play call.
  if (unit === "offense") {
    const startsAt = (pl: Placed) => (path: Pt[]) => path[0][0] === pl.at[0] && path[0][1] === pl.at[1];
    for (const pl of [...skill, ...backs]) {
      const own = card.routeOverrides?.[pl.label];
      if (!own) continue;
      const mine = startsAt(pl);
      const o = pl.x > 250 ? 1 : pl.x < 250 ? -1 : d;
      if (own.path && own.path.length > 0) {
        // A literal detected shape wins over any named route kind: draw it
        // from the player's own spot, same as a hand-picked route would be.
        routes = routes.filter((r) => !mine(r.path));
        blocks.splice(0, blocks.length, ...blocks.filter((b) => !mine(b)));
        targetBlocks.splice(0, targetBlocks.length, ...targetBlocks.filter((t) => !mine(t.path)));
        const path: Pt[] = [pl.at, ...own.path.map(([dx, dy]) => [pl.at[0] + dx, pl.at[1] + dy] as Pt)];
        // A film route snapped to a named route ("SLIDE") keeps that route's number and name.
        const named = own.route && own.route in ROUTE_NAMES ? (own.route as RouteKind) : null;
        routes.push({
          path,
          label: named ? routeLabel(named) : "",
          curve: named === "bubble",
          videoLetter: own.source === "video" || own.source === "ai" ? pl.label : undefined,
        });
        // The alignment check's WING stays in his box when film or a coach draws his route.
        const what = named ? routeText(named) : "Route";
        jobs[pl.label] = jobs[pl.label]?.startsWith("WING") ? `WING · ${what}` : what;
      } else if (own.route) {
        routes = routes.filter((r) => !mine(r.path));
        blocks.splice(0, blocks.length, ...blocks.filter((b) => !mine(b)));
        targetBlocks.splice(0, targetBlocks.length, ...targetBlocks.filter((t) => !mine(t.path)));
        if (own.route === "none") {
          jobs[pl.label] = "—";
        } else if (own.route === "stalk") {
          blocks.push([pl.at, [pl.x, 124]]);
          jobs[pl.label] = "Stalk";
        } else if (own.route === "protect") {
          blocks.push(pl.y === 150 ? [pl.at, [pl.x + o * 8, 162]] : [pl.at, [pl.x + o * 14, pl.y - 12]]);
          jobs[pl.label] = "Pass pro";
        } else if (own.route in ROUTE_NAMES) {
          const routeKind = own.route as RouteKind;
          routes.push({ path: routePath(routeKind, pl.at, o, d), label: routeLabel(routeKind), curve: routeKind === "bubble" });
          jobs[pl.label] = routeText(routeKind);
        }
      }
      if (own.tag) {
        const route = routes.find((r) => mine(r.path));
        if (route) route.label = own.tag;
        jobs[pl.label] = jobs[pl.label] && jobs[pl.label] !== "—" ? `${jobs[pl.label]} · ${own.tag}` : own.tag;
      }
    }
  }

  // Nobody stands around: on a called play every receiver and back either runs a route or
  // blocks. Whatever the call (or the AI) left without a drawn assignment gets the default for
  // his spot. A coach's explicit "No route" stays, and an untagged play (kind "none") is only a
  // formation rep, so there's nothing to assign.
  if (unit === "offense" && kind !== "none") {
    const drawn = [
      ...routes.map((r) => r.path),
      ...blocks,
      ...targetBlocks.map((t) => t.path),
      ...pulls,
      ...fakes,
      ...(carrier ? [carrier] : []),
    ];
    const hasAssignment = (pl: Placed) =>
      drawn.some((path) => path.length > 0 && path[0][0] === pl.at[0] && path[0][1] === pl.at[1]);
    const jobIfBlank = (pl: Placed, job: string) => {
      if (!jobs[pl.label] || jobs[pl.label] === "—") jobs[pl.label] = job;
    };
    for (const pl of [...skill, ...backs]) {
      if (hasAssignment(pl) || card.routeOverrides?.[pl.label]?.route === "none") continue;
      const o = pl.x >= 250 ? 1 : -1;
      if (pl.role === "WR") {
        blocks.push([pl.at, [pl.x, 124]]);
        jobIfBlank(pl, "Stalk");
      } else if (pl.role === "TE") {
        blocks.push(pl.y === 150 ? [pl.at, [pl.x + o * 8, 162]] : [pl.at, [pl.x + o * 14, pl.y - 12]]);
        jobIfBlank(pl, kind === "rpo" ? "Block" : "Pass pro");
      } else if (kind === "run") {
        // A back who isn't carrying it sells the fake.
        fakes.push([pl.at, [pl.x + d * 10, pl.y - 22]]);
        jobIfBlank(pl, "Fake");
      } else {
        blocks.push([pl.at, [pl.x + o * 14, pl.y - 12]]);
        jobIfBlank(pl, kind === "rpo" ? "Block" : "Pass pro");
      }
    }
  }

  const skeleton = mode === "7v7";
  const players: Player[] = [...(skeleton ? [] : line), qb, ...backs, ...skill].map(
    ({ label, role, x, y, ball }) => ({ label, role, x, y, ...(ball ? { ball } : {}) }),
  );
  // In 7v7 there are no linemen, so drop anything that starts on the line.
  const onLine = (path: Pt[]) => line.some((l) => l.at[0] === path[0][0] && l.at[1] === path[0][1]);
  const keep = (path: Pt[]) => !skeleton || !onLine(path);
  const points = (paths: Pt[][]) => paths.filter(keep).map((p) => p.map(toPoint));
  const keptRoutes = routes.filter((r) => keep(r.path));

  const flipped = unit === "defense";
  const hashDx = card.hash ? FIELD.hashX[card.hash] - FIELD.center.x : 0;
  // Ball onto its hash, then (scout defense) turn the card around.
  const turn = <T extends { x: number; y: number }>(p: T): T => {
    const x = mapToHash(p.x, hashDx);
    return flipped ? { ...p, x: FIELD.width - x, y: FIELD.height - p.y } : { ...p, x };
  };
  const marks = fieldMarkings(card.yardLine ?? null);
  const flipY = (y: number) => (flipped ? FIELD.height - y : y);
  const turnAll = (paths: Point[][]) => paths.map((path) => path.map(turn));
  const ballHashX = card.hash ? FIELD.hashX[card.hash] : null;

  return {
    mode,
    unit,
    kind,
    players: players.map(turn),
    carrier: carrier ? carrier.map(toPoint).map(turn) : null,
    routes: turnAll(points(keptRoutes.map((r) => r.path))),
    routeLabels: keptRoutes.map((r) => r.label),
    routeVideoLetters: keptRoutes.map((r) => r.videoLetter ?? null),
    routeLetters: keptRoutes.map(
      (r) => [...skill, ...backs].find((pl) => pl.at[0] === r.path[0][0] && pl.at[1] === r.path[0][1])?.label ?? null,
    ),
    routeKinds: keptRoutes.map((r) => routeKindForLabel(r.label)),
    routeCurves: keptRoutes.map((r) => Boolean(r.curve)),
    routeSummary: unit === "offense" ? summarizeRoutes(card, kind, jobs) : null,
    jobs,
    scheme,
    blocks: turnAll(points(blocks)),
    targetBlocks: targetBlocks.map(({ path, target }) => ({
      path: path.map(toPoint).map(turn),
      target,
    })),
    pulls: turnAll(points(pulls)),
    fakes: turnAll(points(fakes)),
    defense: defense.map(turn),
    defenseNotes: aligned?.notes ?? [],
    ballHashX: ballHashX != null && flipped ? FIELD.width - ballHashX : ballHashX,
    losY: flipY(FIELD.los),
    yardLines: marks.yardLines.map((l) => ({ ...l, y: flipY(l.y) })),
    hashTicks: marks.hashTicks.map(flipY),
    hashDx,
    flipped,
    formationFallback,
    frontFallback,
  };
}

/**
 * A point on a drawn card back to the formation's own coordinates (un-flipped,
 * before the hash shift): how moved defenders are saved, so they stay put if
 * the hash or the card's orientation changes.
 */
export function fromCardPoint(diagram: Pick<Diagram, "flipped" | "hashDx">, p: Point): Point {
  const x = diagram.flipped ? FIELD.width - p.x : p.x;
  const y = diagram.flipped ? FIELD.height - p.y : p.y;
  return { x: Math.round(unmapFromHash(x, diagram.hashDx)), y: Math.round(y) };
}

/** Offensive line keys for the assignment table, playside to backside. */
export const LINE_KEYS = ["PST", "PSG", "C", "BSG", "BST"] as const;
type LineKey = (typeof LINE_KEYS)[number];

/** Default line assignments per run scheme (a tight end on the line gets the PST's). */
const RUN_LINE_JOBS: Record<RunScheme, Record<LineKey, string>> = {
  zone: {
    PST: "Reach",
    PSG: "Reach",
    C: "Reach / combo",
    BSG: "Zone step, cut off",
    BST: "Cut off",
  },
  "outside-zone": { PST: "Reach", PSG: "Reach", C: "Reach", BSG: "Overtake", BST: "Cut off" },
  power: {
    PST: "Down",
    PSG: "Down / double",
    C: "Back block",
    BSG: "Pull, wrap to LB",
    BST: "Hinge",
  },
  counter: {
    PST: "Down",
    PSG: "Down",
    C: "Back block",
    BSG: "Pull, kick out end",
    BST: "Pull, wrap to LB",
  },
  iso: { PST: "Base", PSG: "Climb to LB", C: "Climb to MLB", BSG: "Climb to LB", BST: "Base" },
  draw: {
    PST: "Pass set, drive",
    PSG: "Pass set, drive",
    C: "Pass set, drive",
    BSG: "Pass set, drive",
    BST: "Pass set, drive",
  },
  sneak: { PST: "Wedge", PSG: "Wedge", C: "Wedge", BSG: "Wedge", BST: "Wedge" },
};

export interface AssignmentRow {
  /** Stable key for saving a coach's text ("PST", "Y", "NOTES"). */
  key: string;
  /** Box label ("PST:", "Y:"). */
  label: string;
  /** Text to show: the coach's own words if set, else the auto-generated assignment. */
  text: string;
  /** True when the coach typed this text. */
  custom: boolean;
}

/**
 * The card's assignment table.
 * - Scout offense runs: Y, PST, PSG, C, BSG, BST, NOTES.
 * - Scout offense passes: X, H, Y, Z, F, OL (Team only), NOTES.
 * - Scout defense: FRONT, COVERAGE, NOTES.
 * Coach text (`assignmentNotes`, `notes`) wins over the generated text.
 */
export function buildAssignments(
  card: Pick<HudlPlayCard, "defFront" | "coverage" | "notes" | "assignmentNotes">,
  diagram: Pick<
    Diagram,
    "unit" | "mode" | "kind" | "jobs" | "scheme" | "formationFallback" | "frontFallback"
  > &
    Partial<Pick<Diagram, "defenseNotes">>,
): AssignmentRow[] {
  const own = card.assignmentNotes ?? {};
  const row = (key: string, auto: string): AssignmentRow => ({
    key,
    label: `${key}:`,
    text: own[key] ?? auto,
    custom: own[key] != null,
  });
  const autoNote = [
    diagram.formationFallback ? "Formation not recognized, drawn as Spread." : "",
    diagram.frontFallback ? "No front tagged, drawn as 4-3." : "",
  ]
    .filter(Boolean)
    .join(" ");
  // Scout D: what the alignment rules did ("SS apex Y · S apex H · FS middle").
  const aligned = diagram.unit === "defense" ? (diagram.defenseNotes ?? []).join(" · ") : "";
  const notes: AssignmentRow = {
    key: "NOTES",
    label: "NOTES:",
    text: card.notes || [aligned, autoNote].filter(Boolean).join(" "),
    custom: Boolean(card.notes),
  };

  if (diagram.unit === "defense") {
    return [
      row("FRONT", card.defFront || "4-3 (default)"),
      row("COVERAGE", card.coverage || "—"),
      notes,
    ];
  }
  const job = (label: string) => diagram.jobs[label] ?? "—";
  if (diagram.kind === "run" && diagram.scheme && diagram.mode === "team") {
    const line = RUN_LINE_JOBS[diagram.scheme];
    return [row("Y", job("Y")), ...LINE_KEYS.map((k) => row(k, line[k])), notes];
  }
  const receivers = ["X", "H", "Y", "Z", "F"].map((k) => row(k, job(k)));
  if (diagram.kind === "none") return [...receivers, notes];
  const ol =
    diagram.mode === "team"
      ? [
          row(
            "OL",
            diagram.kind === "rpo"
              ? "Zone (run look)"
              : diagram.kind === "run"
                ? "Run block"
                : "Pass pro",
          ),
        ]
      : [];
  return [...receivers, ...ol, notes];
}

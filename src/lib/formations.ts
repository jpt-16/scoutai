import type { FormationKey, FrontKey, HudlPlayCard, Side } from "./hudlParser";

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
  { label: "", role: "OL", at: [206, 150] },
  { label: "", role: "OL", at: [228, 150] },
  { label: "", role: "OL", at: [250, 150] },
  { label: "", role: "OL", at: [272, 150] },
  { label: "", role: "OL", at: [294, 150] },
];

export const FORMATIONS: Record<Exclude<FormationKey, "unknown">, FormationShape> = {
  spread: {
    qb: [250, 190],
    backs: [{ label: "F", role: "RB", at: [276, 192] }],
    skill: [
      { label: "X", role: "WR", at: [36, 150] },
      { label: "H", role: "WR", at: [112, 160] },
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
  pro: {
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
      { label: "E", at: [196, 128] },
      { label: "T", at: [238, 128] },
      { label: "T", at: [266, 128] },
      { label: "E", at: [306, 128] },
    ],
    lb: [
      { label: "W", at: [204, 94] },
      { label: "M", at: [250, 90] },
      { label: "S", at: [296, 94] },
    ],
  },
  "3-4": {
    dl: [
      { label: "E", at: [214, 128] },
      { label: "N", at: [250, 128] },
      { label: "E", at: [286, 128] },
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
      { label: "E", at: [184, 128] },
      { label: "T", at: [216, 128] },
      { label: "N", at: [250, 128] },
      { label: "T", at: [284, 128] },
      { label: "E", at: [316, 128] },
    ],
    lb: [
      { label: "W", at: [226, 92] },
      { label: "M", at: [274, 92] },
    ],
  },
  bear: {
    dl: [
      { label: "E", at: [178, 128] },
      { label: "T", at: [210, 128] },
      { label: "N", at: [250, 128] },
      { label: "T", at: [290, 128] },
      { label: "E", at: [322, 128] },
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
  /** E, T, N (line), W, M, S, B (backers), C, FS, SS (secondary). */
  label: string;
  x: number;
  y: number;
}

/**
 * Where the scout defense lines up against the (already mirrored) offense:
 * the front's box players, corners over the widest receiver on each side,
 * and safeties shaded to the receiver-heavy side (Bear rolls one down).
 */
function buildDefense(
  frontKey: Exclude<FrontKey, "unknown">,
  skill: Pt[],
  strength: Side,
  dropLine: boolean,
): Defender[] {
  const front = FRONTS[frontKey];
  const xs = skill.map(([x]) => x);
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
  const box = [...(dropLine ? [] : front.dl), ...front.lb].map((s) => ({
    label: s.label,
    at: mirrorX(s.at, strength),
  }));
  return [...box, ...secondary].map(({ label, at }) => ({ label, x: at[0], y: at[1] }));
}

/* -------------------------------------------------------------------------- */
/*                               Play reading                                 */
/* -------------------------------------------------------------------------- */

/** How a play is drawn: run blocking, a pass with routes, or a run/pass mix. */
export type PlayKind = "run" | "pass" | "rpo" | "pa" | "none";

export type RunScheme = "zone" | "outside-zone" | "power" | "counter" | "iso" | "draw" | "sneak";

export type RouteKind =
  | "go"
  | "fade"
  | "slant"
  | "out"
  | "corner"
  | "post"
  | "curl"
  | "dig"
  | "wheel"
  | "cross"
  | "flat"
  | "swing"
  | "bubble"
  | "leak";

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
  [/^(CURLS?|HITCH|HITCHES|STICK|HOOKS?|STOP)$/, "curl"],
  [/^(DIGS?|SQUARE)$/, "dig"],
  [/^WHEELS?$/, "wheel"],
  [/^(ACROSS|CROSS|CROSSERS?|CROSSING|MESH|SHALLOW|DRAGS?)$/, "cross"],
  [/^FLATS?$/, "flat"],
  [/^SWING$/, "swing"],
  [/^(BUBBLE|SCREEN|TUNNEL|NOW)$/, "bubble"],
  [/^LEAK$/, "leak"],
];

/** Route names in the order they appear in the play call ("FADE OUT OUT FADE"). */
export function routeTokens(playCall: string): RouteKind[] {
  const tokens: RouteKind[] = [];
  for (const word of words(playCall).trim().split(" ")) {
    const hit = ROUTE_WORDS.find(([re]) => re.test(word));
    if (hit) tokens.push(hit[1]);
  }
  return tokens;
}

const RUN_CONCEPTS = new Set(["inside-zone", "outside-zone", "power", "sweep", "qb-run"]);
const PASS_CONCEPTS = new Set(["verticals", "slant", "screen", "dropback", "boot"]);

export function playKind(card: Pick<HudlPlayCard, "playCall" | "concept">): PlayKind {
  const w = words(card.playCall);
  if (/ RPO /.test(w)) return "rpo";
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
  card: Pick<HudlPlayCard, "playCall" | "concept" | "formation" | "defFront">,
  period: Period,
  unit: ScoutUnit,
): boolean {
  if (period === "all") return true;
  if (unit === "defense") return Boolean(card.formation || card.defFront);
  if (period === "7v7") return isPassPlay(card) || playKind(card) === "none";
  return playKind(card) !== "none";
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
  players: Player[];
  /** Ball carrier's path on runs (arrow). */
  carrier: Point[] | null;
  /** Receiver routes (arrows). */
  routes: Point[][];
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
  /** X position of the hash the ball is on (null when unknown). */
  ballHashX: number | null;
  /** Y of the line of scrimmage as drawn (moves when the card is flipped). */
  losY: number;
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

const clampX = (x: number) => Math.min(488, Math.max(12, x));
const clampY = (y: number) => Math.max(22, y);
const toPoint = ([x, y]: Pt): Point => ({ x: clampX(x), y: clampY(y) });

function mirrorX(p: Pt, side: Side): Pt {
  return side === "left" ? [FIELD.width - p[0], p[1]] : p;
}

function place(slot: Slot, side: Side): Placed {
  const at = mirrorX(slot.at, side);
  return { label: slot.label, role: slot.role, x: at[0], y: at[1], at };
}

/** Route shape for one receiver. `o` = +1 toward the right sideline for this player, -1 left. */
function routePath(kind: RouteKind, p: Pt, o: number, d: number): Pt[] {
  const [x, y] = p;
  switch (kind) {
    case "go":
      return [p, [x, 34]];
    case "fade":
      return [p, [x, 110], [x + o * 14, 34]];
    case "slant":
      return [p, [x, 130], [x - o * 58, 90]];
    case "out":
      return [p, [x, 104], [x + o * 44, 104]];
    case "corner":
      return [p, [x, 100], [x + o * 46, 60]];
    case "post":
      return [p, [x, 100], [x - o * 46, 50]];
    case "curl":
      return [p, [x, 104], [x - o * 8, 114]];
    case "dig":
      return [p, [x, 96], [x - o * 70, 96]];
    case "wheel":
      return [p, [x + o * 30, y + 4], [x + o * 48, 118], [x + o * 48, 40]];
    case "cross":
      return [p, [x, 128], [x - o * 160, 116]];
    case "flat":
      return [p, [x + o * 18, y - 14], [x + o * 60, y - 18]];
    case "swing":
      return [p, [x + d * 34, y + 6], [x + d * 76, y - 12]];
    case "bubble":
      return [p, [x + o * 22, y + 16], [x + o * 56, y + 12]];
    case "leak":
      return [p, [x, 132], [x - o * 50, 120], [x - o * 150, 108]];
  }
}

/** Receiver routes for a pass, RPO, or play-action call. */
function buildRoutes(
  playCall: string,
  skill: Placed[],
  backs: Placed[],
  d: number,
): { routes: Pt[][]; stalks: Pt[][]; targeted: { path: Pt[]; target: string }[] } {
  const side = (x: number) => (x > 250 ? 1 : x < 250 ? -1 : d);
  const tokens = routeTokens(playCall);
  const routes: Pt[][] = [];
  const stalks: Pt[][] = [];
  const targeted: { path: Pt[]; target: string }[] = [];
  const assigned = new Set<Placed>();
  const run = (pl: Placed, kind: RouteKind) => {
    routes.push(routePath(kind, pl.at, side(pl.x), d));
    assigned.add(pl);
  };

  // LEAK belongs to a tight end (or the back when there isn't one).
  const leaks = tokens.filter((t) => t === "leak").length;
  const others = tokens.filter((t) => t !== "leak");
  const leaker = skill.find((p) => p.role === "TE") ?? backs[backs.length - 1];
  if (leaks > 0 && leaker) run(leaker, "leak");

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
        assigned.add(p);
      });
      for (const p of receivers) {
        if (!assigned.has(p) && p.role === "WR") stalks.push([p.at, [p.x, 124]]);
      }
    } else {
      // "SLANT", "VERTS", "FADE": every wide receiver runs it (TEs too on verticals).
      for (const p of receivers) {
        if (p.role === "WR" || only === "go") run(p, only);
      }
    }
  } else if (others.length > 1) {
    // Several routes read left to right across the formation ("FADE OUT OUT FADE").
    const eligible =
      others.length > receivers.length
        ? [...receivers, ...backs.filter((b) => !assigned.has(b))].sort((a, b) => a.x - b.x)
        : receivers;
    others.slice(0, eligible.length).forEach((kind, i) => run(eligible[i], kind));
  }
  return { routes, stalks, targeted };
}

/** Offensive line (and tight end / fullback) assignments for a run scheme. */
function buildBlocking(
  scheme: RunScheme,
  line: Placed[],
  backs: Placed[],
  carrier: Placed | undefined,
  d: number,
): { blocks: Pt[][]; pulls: Pt[][] } {
  const at = (dx: number, y: number): Pt => [250 + d * dx, y];
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
              ? [p.at, [x, 170], at(44, 170), at(56, 126)] // wraps up through the hole
              : [p.at, [x, 166], at(72, 166), at(84, 136)], // counter: kicks out the end
          );
        else if (p === backsideTackle && scheme === "counter")
          pulls.push([p.at, [x, 176], at(58, 178), at(64, 118)]); // counter: tackle wraps
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
      return [c, [c[0] - d * 16, c[1] + 4], at(40, 176), at(58, 96)];
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
  >,
  mode: DiagramMode = "team",
  unit: ScoutUnit = "offense",
): Diagram {
  const formationFallback = card.formationKey === "unknown";
  const shape =
    FORMATIONS[formationFallback ? "spread" : (card.formationKey as keyof typeof FORMATIONS)];
  const side = card.formationSide;
  const d = card.playDirection === "right" ? 1 : -1;
  const kind = playKind(card);

  const line = OFFENSIVE_LINE.map((s) => place(s, side));
  const qb = place({ label: "Q", role: "QB", at: shape.qb }, side);
  const backs = shape.backs.map((s) => place(s, side));
  const skill = shape.skill.map((s) => place(s, side));
  const tightEndsOnLine = skill.filter((p) => p.role === "TE" && p.y === 150);

  const blocks: Pt[][] = [];
  const targetBlocks: { path: Pt[]; target: string }[] = [];
  const pulls: Pt[][] = [];
  const fakes: Pt[][] = [];
  let routes: Pt[][] = [];
  let carrier: Pt[] | null = null;
  const ballCarrier = card.concept === "qb-run" ? qb : backs[backs.length - 1];

  const frontFallback = unit === "defense" && card.frontKey === "unknown";
  const defense =
    unit === "defense"
      ? buildDefense(
          frontFallback ? "4-3" : (card.frontKey as Exclude<FrontKey, "unknown">),
          skill.map((p) => p.at),
          side,
          mode === "7v7",
        )
      : [];

  if (unit === "defense") {
    // The scout defense only needs the formation it's lining up against.
  } else if (kind === "run") {
    const scheme = runScheme(card);
    const blocking = buildBlocking(scheme, [...line, ...tightEndsOnLine], backs, ballCarrier, d);
    blocks.push(...blocking.blocks);
    pulls.push(...blocking.pulls);
    carrier = ballCarrier ? carrierPath(scheme, ballCarrier.at, d) : null;
    // Receivers stalk-block the perimeter instead of running routes.
    for (const p of skill) {
      if (p.role === "WR") blocks.push([p.at, [p.x, 124]]);
    }
  } else if (kind !== "none") {
    const passing = buildRoutes(card.playCall, skill, backs, d);
    routes = passing.routes;
    blocks.push(...passing.stalks);
    targetBlocks.push(...passing.targeted);
    const rb = backs[backs.length - 1];
    if ((kind === "rpo" || kind === "pa") && rb) {
      // The mesh / run fake: the back's run path, dashed.
      fakes.push([rb.at, [250 + d * 12, 150], [250 + d * 20, 110]]);
      if (kind === "rpo" && mode === "team") {
        // RPO: the line blocks it like a run (zone).
        const zone = buildBlocking("zone", [...line, ...tightEndsOnLine], [], undefined, d);
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

  const skeleton = mode === "7v7";
  const players: Player[] = [...(skeleton ? [] : line), qb, ...backs, ...skill].map(
    ({ label, role, x, y }) => ({ label, role, x, y }),
  );
  // In 7v7 there are no linemen, so drop anything that starts on the line.
  const onLine = (path: Pt[]) => line.some((l) => l.at[0] === path[0][0] && l.at[1] === path[0][1]);
  const keep = (path: Pt[]) => !skeleton || !onLine(path);
  const points = (paths: Pt[][]) => paths.filter(keep).map((p) => p.map(toPoint));

  const flipped = unit === "defense";
  const turn = <T extends { x: number; y: number }>(p: T): T =>
    flipped ? { ...p, x: FIELD.width - p.x, y: FIELD.height - p.y } : p;
  const turnAll = (paths: Point[][]) => paths.map((path) => path.map(turn));
  const ballHashX = card.hash ? FIELD.hashX[card.hash] : null;

  return {
    mode,
    unit,
    kind,
    players: players.map(turn),
    carrier: carrier ? carrier.map(toPoint).map(turn) : null,
    routes: turnAll(points(routes)),
    blocks: turnAll(points(blocks)),
    targetBlocks: targetBlocks.map(({ path, target }) => ({
      path: path.map(toPoint).map(turn),
      target,
    })),
    pulls: turnAll(points(pulls)),
    fakes: turnAll(points(fakes)),
    defense: defense.map(turn),
    ballHashX: ballHashX != null && flipped ? FIELD.width - ballHashX : ballHashX,
    losY: flipped ? FIELD.height - FIELD.los : FIELD.los,
    flipped,
    formationFallback,
    frontFallback,
  };
}

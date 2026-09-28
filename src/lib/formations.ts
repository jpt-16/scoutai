import type { FormationKey, FrontKey, HudlPlayCard, PlayConcept, Side } from "./hudlParser";

/**
 * Coordinate system for every scout card diagram:
 * - SVG viewBox is 500 x 300; x runs across the field, y runs downfield.
 * - The ball / center sits at (250, 150). The line of scrimmage is y = 140.
 * - Offense is below the LOS (larger y), defense above it.
 * - Hash marks sit at x = 167 and x = 333 (thirds of the field, HS rules).
 * All dictionaries below are drawn with the formation's strength to the RIGHT;
 * `buildDiagram` mirrors them for left-handed formations.
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

interface FormationShape {
  qb: Pt;
  /** Backs, ordered so the LAST one is the primary ball carrier. */
  backs: Pt[];
  /** Receivers and tight ends. */
  skill: Pt[];
}

/** Guards and tackles; the center is drawn separately at FIELD.center. */
const OFFENSIVE_LINE: Pt[] = [
  [206, 150],
  [228, 150],
  [272, 150],
  [294, 150],
];

export const FORMATIONS: Record<Exclude<FormationKey, "unknown">, FormationShape> = {
  spread: {
    qb: [250, 190],
    backs: [[276, 192]],
    skill: [[36, 150], [112, 160], [388, 160], [464, 150]],
  },
  trips: {
    qb: [250, 190],
    backs: [[224, 192]],
    skill: [[36, 150], [336, 160], [400, 160], [464, 150]],
  },
  "i-form": {
    qb: [250, 166],
    backs: [[250, 198], [250, 230]],
    skill: [[40, 150], [316, 150], [444, 160]],
  },
  "double-eagle": {
    qb: [250, 166],
    backs: [[250, 214]],
    skill: [[184, 150], [316, 150], [162, 166], [338, 166]],
  },
  pro: {
    qb: [250, 166],
    backs: [[222, 206], [278, 206]],
    skill: [[40, 150], [316, 150], [444, 160]],
  },
};

interface FrontShape {
  dl: Pt[];
  lb: Pt[];
}

export const FRONTS: Record<Exclude<FrontKey, "unknown">, FrontShape> = {
  "4-3": {
    dl: [[196, 128], [238, 128], [266, 128], [306, 128]],
    lb: [[204, 94], [250, 90], [296, 94]],
  },
  "3-4": {
    dl: [[214, 128], [250, 128], [286, 128]],
    lb: [[172, 118], [228, 92], [272, 92], [328, 118]],
  },
  "5-2": {
    dl: [[184, 128], [216, 128], [250, 128], [284, 128], [316, 128]],
    lb: [[226, 92], [274, 92]],
  },
  bear: {
    dl: [[178, 128], [210, 128], [250, 128], [290, 128], [322, 128]],
    lb: [[228, 92], [272, 92]],
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

export const FRONT_LABELS: Record<FrontKey, string> = {
  "4-3": "4-3",
  "3-4": "3-4",
  "5-2": "5-2",
  bear: "Bear",
  unknown: "Other",
};

export interface Diagram {
  /** Offensive players except the center. */
  offense: Point[];
  center: Point;
  defense: Point[];
  /** Each route is a polyline from the player outward; the last point gets an arrowhead. */
  routes: Point[][];
  /** X position of the hash the ball is on (null when unknown). */
  ballHashX: number | null;
  /** True when the formation/front text wasn't recognized and a default was drawn. */
  formationFallback: boolean;
  frontFallback: boolean;
}

const toPoint = ([x, y]: Pt): Point => ({ x, y });

function mirrorX(p: Pt, side: Side): Pt {
  return side === "left" ? [FIELD.width - p[0], p[1]] : p;
}

function buildDefense(front: FrontShape, isBear: boolean, skill: Pt[], strength: Side): Pt[] {
  const xs = skill.map(([x]) => x);
  const leftmost = Math.min(...xs);
  const rightmost = Math.max(...xs);
  const rightCount = xs.filter((x) => x > 250).length;
  const leftCount = xs.length - rightCount;
  const shade = rightCount > leftCount ? 24 : leftCount > rightCount ? -24 : 0;
  // Corners press the widest receiver on each side, a little deeper when split wide.
  const cornerY = (x: number) => (x < 110 || x > 390 ? 112 : 100);
  const corners: Pt[] = [
    [Math.min(leftmost, 150), cornerY(leftmost)],
    [Math.max(rightmost, 350), cornerY(rightmost)],
  ];
  // Bear rolls the strong safety down; balanced sets use the formation's strength.
  const strongDir = shade !== 0 ? Math.sign(shade) : strength === "left" ? -1 : 1;
  const safeties: Pt[] = isBear
    ? [
        [250 + shade, 48],
        [250 + strongDir * 70, 104],
      ]
    : [
        [180 + shade, 52],
        [320 + shade, 52],
      ];
  // Fronts are drawn strength-right; flip the box to face a left-handed set.
  const box = [...front.dl, ...front.lb].map((p) => mirrorX(p, strength));
  return [...box, ...corners, ...safeties];
}

function buildRoutes(
  concept: PlayConcept,
  qb: Pt,
  backs: Pt[],
  skill: Pt[],
  direction: Side,
): Pt[][] {
  const d = direction === "right" ? 1 : -1;
  const at = (dx: number, y: number): Pt => [250 + d * dx, y];
  const carrier = backs[backs.length - 1] ?? qb;
  const playSide = skill
    .filter(([x]) => (x - 250) * d > 0)
    .sort((a, b) => Math.abs(a[0] - 250) - Math.abs(b[0] - 250));
  const outer = playSide[playSide.length - 1] ?? skill[0];
  const slot = playSide[0] ?? outer;

  switch (concept) {
    case "inside-zone":
      return [[carrier, at(12, 150), at(20, 92)]];
    case "outside-zone":
      return [[carrier, at(50, carrier[1] + 2), at(110, 150), at(130, 100)]];
    case "power":
      return [[carrier, at(48, 170), at(62, 96)]];
    case "sweep":
      return [[carrier, at(90, carrier[1] + 4), at(170, 172), at(190, 100)]];
    case "qb-run":
      return [[qb, at(6, 146), at(6, 96)]];
    case "verticals":
      return skill.map((p) => [p, [p[0], 40] as Pt]);
    case "slant":
      return [[outer, [outer[0], 128], [outer[0] - d * 64, 82]]];
    case "screen":
      return [[slot, [slot[0] + d * 26, slot[1] + 22], [slot[0] + d * 64, slot[1] + 16]]];
    case "boot":
      return [[qb, at(80, qb[1] + 12), at(122, 170)]];
    case "dropback":
      return [
        [qb, [qb[0], qb[1] + 34]],
        [outer, [outer[0], 70], [outer[0] - d * 12, 84]],
      ];
    default:
      return [];
  }
}

/** Places every player and route for a parsed Hudl play. */
export function buildDiagram(card: Pick<
  HudlPlayCard,
  "formationKey" | "formationSide" | "frontKey" | "concept" | "playDirection" | "hash"
>): Diagram {
  const formationFallback = card.formationKey === "unknown";
  const frontFallback = card.frontKey === "unknown";
  const shape = FORMATIONS[formationFallback ? "spread" : (card.formationKey as keyof typeof FORMATIONS)];
  const front = FRONTS[frontFallback ? "4-3" : (card.frontKey as keyof typeof FRONTS)];
  const side = card.formationSide;

  const qb = mirrorX(shape.qb, side);
  const backs = shape.backs.map((p) => mirrorX(p, side));
  const skill = shape.skill.map((p) => mirrorX(p, side));

  return {
    offense: [...OFFENSIVE_LINE, qb, ...backs, ...skill].map(toPoint),
    center: FIELD.center,
    defense: buildDefense(front, card.frontKey === "bear", skill, side).map(toPoint),
    routes: buildRoutes(card.concept, qb, backs, skill, card.playDirection).map((r) => r.map(toPoint)),
    ballHashX: card.hash ? FIELD.hashX[card.hash] : null,
    formationFallback,
    frontFallback,
  };
}

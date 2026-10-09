/**
 * Text → scout card: the pure half of `/api/generate-scout-card`. The route
 * sends a play call ("Deuces Mesh Rail") to Gemini with the prompt built
 * here, and the answer (0-100 grid coordinates for all 22 players) becomes a
 * normal `HudlPlayCard`:
 *
 * - The formation is drawn in its usual shape, exactly like a CSV row. The
 *   prompt hands the model those exact spots, so the routes it draws start
 *   where the card's players actually stand.
 * - Each receiver's route becomes a `routeOverrides` path (`source: "ai"`),
 *   the same mechanism video detection uses, so it gets draggable break
 *   points on the card.
 * - Each defender lands in `defenseOverrides`, keyed by the card's own
 *   defender ids ("FS1", "C2"), so Adjust X's moves them like any other.
 *
 * Framework-free, so it's unit-testable without a Gemini key.
 */

import { splitLook } from "./practicePlan";
import { detectedRouteToPathDeltas } from "./coordinateMapper";
import { buildDiagram, FIELD, fromCardPoint } from "./formations";
import { deriveCard, type HudlPlayCard, type RouteOverride } from "./hudlParser";
import { FOOTBALL_CONCEPT_RULES } from "./videoDetection";
import { clampSafetyDepth, safetyDepthFor, safetyY } from "./defensiveAligner";

export interface GenerateCardInput {
  playName: string;
  formation: string;
  defensiveCall?: string;
  /** The coach's safety depth in yards off the line (FS and SS), if set. */
  safetyDepth?: number;
}

/** A point on the 0-100 grid (see `GRID_RULES`). */
export interface GridPoint {
  x: number;
  y: number;
}

export const OFFENSE_LABELS = ["Q", "F", "H", "X", "Y", "Z", "OL"] as const;
export const DEFENSE_LABELS = ["E", "T", "N", "W", "M", "S", "B", "C", "FS", "SS"] as const;

export interface GeneratedPlay {
  offense: { label: string; x: number; y: number; routeName?: string; route?: GridPoint[] }[];
  defense: { label: string; x: number; y: number }[];
}

/** What the card will draw before any AI coordinates: where to tell the model everyone stands. */
export interface GenerationContext {
  offense: { label: string; x: number; y: number }[];
  defense: { id: string; label: string; x: number; y: number }[];
}

export const MAX_INPUT_LENGTH = 80;

/** One short, quote-free line: model input never gets to break out of its quotes. */
export function oneLine(text: string | undefined, max = MAX_INPUT_LENGTH): string {
  return (text ?? "")
    .replace(/[\r\n"'`\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
/** Card SVG units (500 × 300) → the 0-100 grid, and back. */
export const toGrid = (p: { x: number; y: number }): GridPoint => ({
  x: round1((p.x / FIELD.width) * 100),
  y: round1((p.y / FIELD.height) * 100),
});
export const fromGrid = (p: GridPoint): { x: number; y: number } => ({
  x: (p.x / 100) * FIELD.width,
  y: (p.y / 100) * FIELD.height,
});

const LOS_GRID = round1((FIELD.los / FIELD.height) * 100);
const YARD_Y = round1((7 / FIELD.height) * 100 * 100) / 100; // 7 px a yard (YARD_PX)
const YARD_X = round1((FIELD.width / (160 / 3) / FIELD.width) * 100 * 100) / 100;

const GRID_RULES = `COORDINATES: a 0-100 grid of the field seen from behind the offense.
- x: 0 = left sideline, 100 = right sideline. The ball is at x = 50.
- y: 0 = top of the picture (downfield), 100 = bottom (behind the offense).
- The line of scrimmage is y = ${LOS_GRID}. Offense is at y >= ${LOS_GRID}, defense at y < ${LOS_GRID}.
- One yard downfield = ${YARD_Y} y-units; one yard across = ${YARD_X} x-units. Route depths are
  yards past the line of scrimmage, so a 5-yard drag sits at y = ${round1(LOS_GRID - 5 * YARD_Y)}.`;

const DEFENSE_RULES = `DEFENSE: place all 11 defenders using exactly the labels listed, per the defensive call:
- Linemen (E, T, N) on the line of scrimmage, about 1 yard off the ball, over their gaps.
- Linebackers (W, M, S, B) 4-5 yards deep in the box.
- Cover 0: no deep safety; corners and safeties press or play man 1-5 yards off.
- Cover 1: FS alone in the middle 12-14 yards deep; SS down in the box at 5-8; corners man, 1-7 off.
- Cover 2: two safeties 12-14 deep over the hashes; corners squat at 5-7 yards, outside the #1s.
- Cover 3: FS alone in the middle 12-15 deep; corners 7-10 off in deep thirds; SS rolled down to
  the strength at 7-8 as the curl-flat player.
- Cover 4 / Quarters: two safeties 10-12 deep, just inside the #2s; corners 7-8 off.
- Cover 6: quarters to the strength, Cover 2 (squat corner, half-field safety) to the weak side.
- No call: a sound Cover 3.
- Rule: Ensure 100% receiver coverage. Every split receiver has a defender leveraged over him:
  corners on the #1s. If the offense presents 2 or more split receivers to a side, align a Safety
  or Nickel DB directly over (man) or apexed (zone: halfway between #2 and the next man inside)
  on the #2 receiver. Any receiver still uncovered (the other #2 in 2x2, #3 in trips) gets an
  outside linebacker walked out to apex him; never stack the box while a receiver stands alone.`;

/** The card as drawn before any AI coordinates: formation from the text, front from the call. */
export function shellCard(input: GenerateCardInput): HudlPlayCard {
  const formation = oneLine(input.formation);
  const play = oneLine(input.playName);
  // "Deuces Mesh Rail" with formation "Deuces": the title shouldn't say Deuces twice.
  const playCall =
    formation && play.toUpperCase().startsWith(`${formation.toUpperCase()} `)
      ? play.slice(formation.length).trim()
      : play;
  const look = splitLook(oneLine(input.defensiveCall));
  // A bare coverage ("Cover 3") isn't a front: leave the front to the card's default.
  const front = look.front && !look.coverage && /^C(OVER)?\s*\d/i.test(look.front) ? "" : look.front;
  const coverage = look.coverage || (front ? "" : look.front);
  return deriveCard({
    id: `ai-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    playNumber: 1,
    rowIndex: 0,
    down: null,
    distance: null,
    isGoalToGo: false,
    yardLine: null,
    yardLineLabel: "",
    hash: null,
    formation,
    offStrength: "",
    playCall,
    playType: "",
    playDir: "",
    defFront: front,
    coverage,
    result: "",
    notes: "",
    source: "AI generated",
    raw: {},
    ...(input.safetyDepth != null
      ? { defenseAlignment: { safetyDepthY: clampSafetyDepth(input.safetyDepth) } }
      : {}),
  });
}

/** Where the card puts everyone, in grid units, un-flipped (offense view). */
export function generationContext(card: HudlPlayCard): GenerationContext {
  const offense = buildDiagram(card, "team", "offense").players.map((p) => ({
    label: p.label || "OL",
    ...toGrid(p),
  }));
  const defDiagram = buildDiagram(card, "team", "defense");
  const defense = defDiagram.defense.map((d) => ({
    id: d.id,
    label: d.label,
    ...toGrid(fromCardPoint(defDiagram, d)),
  }));
  return { offense, defense };
}

export function buildGenerationPrompt(input: GenerateCardInput, ctx: GenerationContext): string {
  const call = oneLine(input.playName);
  const formation = oneLine(input.formation);
  const defense = oneLine(input.defensiveCall);
  const lineup = ctx.offense.map((p) => `${p.label} (${p.x}, ${p.y})`).join(", ");
  const defLabels = ctx.defense.map((d) => d.label).join(", ");
  const defSpots = ctx.defense.map((d) => `${d.label} (${d.x}, ${d.y})`).join(", ");
  const depth = input.safetyDepth != null ? clampSafetyDepth(input.safetyDepth) : null;
  const depthRule =
    depth != null
      ? `- Rule: Honor the user-defined safety depth: FS and SS start ${depth} yards off the line of
  scrimmage (y = ${round1(LOS_GRID - depth * YARD_Y)}), whatever the coverage says; keep their spot across the field.`
      : "- Safety depth: per the coverage above.";
  return `You are an expert high school football coach drawing one scout card.

PLAY CALL: "${call}"
FORMATION: "${formation || "not given"}"
DEFENSIVE CALL: "${defense || "not given"}"

${GRID_RULES}

OFFENSE: return all 11 offensive players, using exactly this staff's letters: Q (quarterback),
F and H (backs / slots), X, Y, Z (receivers or tight end), and OL for each of the 5 linemen.
They line up exactly here, so return these same starting spots: ${lineup}.
For every receiver and back with a route, give "route": the points of the route AFTER the
start, in order, one point at each break and one at the end, as straight segments with sharp
breaks, and a short "routeName". Linemen, and a back who stays in to block, get no route.

${FOOTBALL_CONCEPT_RULES}

${DEFENSE_RULES}
${depthRule}
Use exactly these 11 defensive labels: ${defLabels}.
The app's own alignment rules start them here (adjust for the call): ${defSpots}.`;
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Runtime check on the model's JSON before it's trusted; a reason string, or null when usable. */
export function validateGeneratedPlay(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "Not an object";
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.offense) || v.offense.length === 0) return "No offensive players";
  if (!Array.isArray(v.defense)) return "No defensive players";
  for (const p of [...v.offense, ...v.defense] as Record<string, unknown>[]) {
    if (typeof p !== "object" || p === null) return "A player isn't an object";
    if (typeof p.label !== "string") return "A player has no label";
    if (!isNum(p.x) || !isNum(p.y)) return `Player ${p.label} has no position`;
    if (p.route !== undefined) {
      if (!Array.isArray(p.route)) return `Player ${p.label}'s route isn't a list`;
      if (!(p.route as Record<string, unknown>[]).every((q) => isNum(q?.x) && isNum(q?.y))) {
        return `Player ${p.label}'s route has a bad point`;
      }
    }
  }
  return null;
}

const clampGrid = (p: GridPoint): GridPoint => ({
  x: Math.min(100, Math.max(0, p.x)),
  y: Math.min(100, Math.max(0, p.y)),
});

const ROUTE_LETTERS = new Set(["F", "H", "X", "Y", "Z"]);

/**
 * The shell card plus the model's coordinates: a route per receiver (drawn
 * from where the card's player stands) and every defender moved onto the
 * card's own ids, nearest-first within each label.
 */
export function applyGeneratedPlay(
  card: HudlPlayCard,
  ctx: GenerationContext,
  gen: GeneratedPlay,
): HudlPlayCard {
  const bounds = { width: FIELD.width, height: FIELD.height };
  const routeOverrides: Record<string, RouteOverride> = {};
  for (const p of gen.offense) {
    if (!ROUTE_LETTERS.has(p.label) || routeOverrides[p.label] || !p.route?.length) continue;
    const route = p.route.map(clampGrid);
    const path = detectedRouteToPathDeltas(
      { start: clampGrid(p), waypoints: route.slice(0, -1), endpoint: route[route.length - 1] },
      bounds,
    );
    if (path.length === 0) continue;
    routeOverrides[p.label] = {
      path,
      source: "ai",
      ...(p.routeName ? { tag: oneLine(p.routeName, 10).toUpperCase() } : {}),
    };
  }

  const defenseOverrides: Record<string, { x: number; y: number }> = {};
  const unused = gen.defense.map(clampGrid).map((p, i) => ({ ...p, label: gen.defense[i].label }));
  for (const slot of ctx.defense) {
    let best = -1;
    let bestDist = Infinity;
    unused.forEach((p, i) => {
      if (p.label !== slot.label) return;
      const dist = Math.hypot(p.x - slot.x, p.y - slot.y);
      if (dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    });
    if (best < 0) continue;
    const [p] = unused.splice(best, 1);
    // Defense stays on its own side of the ball.
    const at = fromGrid({ x: p.x, y: Math.min(p.y, LOS_GRID - 1) });
    // The coach's safety depth wins over the model's.
    const depth = safetyDepthFor(card.defenseAlignment, slot.label);
    const y = depth != null ? safetyY(depth) : at.y;
    defenseOverrides[slot.id] = { x: Math.round(at.x), y: Math.round(y) };
  }

  return {
    ...card,
    routeOverrides,
    ...(Object.keys(defenseOverrides).length ? { defenseOverrides } : {}),
  };
}

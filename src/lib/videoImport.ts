/**
 * Turns a validated vision-model detection (see `/api/parse-video`) into a
 * real `HudlPlayCard`, the same shape a CSV row produces — so a video-derived
 * card flows through the exact same script/print/filter/storage pipeline as
 * every other card. Framework-free, so it's directly unit-testable.
 */

import { buildDiagram, FIELD, YARD_PX, YARD_X } from "./formations";
import { detectedRouteToPathDeltas, yardRouteToPathDeltas, type PercentPoint } from "./coordinateMapper";
import { deriveCard, parseHash, updateCard, type HudlPlayCard, type PlaySource } from "./hudlParser";

/** Skill-player letters this app draws (see `CLAUDE.md`: linemen are unlabeled). */
export const DETECTED_PLAYER_LABELS = ["Q", "F", "H", "X", "Y", "Z"] as const;
export type DetectedPlayerLabel = (typeof DETECTED_PLAYER_LABELS)[number];

/** One player's detected route, as the vision model should return it. */
export interface DetectedPlayer {
  label: string;
  start: PercentPoint;
  waypoints: PercentPoint[];
  endpoint: PercentPoint;
  /** Free-text route name the model guessed ("SLANT"), shown as a tag on the card. */
  routeType?: string;
}

/** The vision model's response shape for one play. */
export interface DetectedPlay {
  playName: string;
  formation: string;
  players: DetectedPlayer[];
  /** From the QB anchor rule: what the QB did with the ball. */
  playType?: "run" | "pass" | "unknown";
  /** Who got the ball from the QB ("Q" if he kept it, "none" if unclear). */
  ballCarrier?: string;
  /** Where the ball went, the offense's left / right facing upfield. */
  ballDirection?: "left" | "right" | "middle" | "unknown";
  /**
   * What the points are measured in. `"yards"` (what the film prompt asks
   * for): x = yards to the offense's right (+) / left (−) of the ball, y =
   * yards past the line (+) / behind it (−). Older answers: percent of the frame.
   */
  units?: "yards" | "frame";
  /** Where the camera was ("sideline", "endzone"), for the record. */
  camera?: string;
  /** Hudl's data bar, when the clip is a recording of Hudl with it on screen: the staff's own tags. */
  hudl?: HudlBar;
}

/** Hudl's on-screen data bar, transcribed ("" for anything not shown). */
export interface HudlBar {
  playNumber?: string;
  formation?: string;
  playCall?: string;
  playType?: string;
  hash?: string;
  offStrength?: string;
  playDir?: string;
}

const barText = (v: unknown, max = 60) =>
  typeof v === "string" ? v.replace(/[\r\n"'`\\]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

/** The data bar's fields, cleaned to one short line each; nothing the bar didn't show. */
export function hudlBarFields(detection: DetectedPlay): Required<HudlBar> {
  const bar = detection.hudl ?? {};
  return {
    playNumber: barText(bar.playNumber, 6),
    formation: barText(bar.formation),
    playCall: barText(bar.playCall),
    playType: barText(bar.playType, 12),
    hash: barText(bar.hash, 6),
    offStrength: barText(bar.offStrength, 6),
    playDir: barText(bar.playDir, 6),
  };
}

/** What the film says about the ball, as card fields; only what the model actually saw. */
export function ballFromDetection(detection: DetectedPlay): {
  carrier: string | null;
  playDir: "L" | "R" | "";
  playType: "Run" | "Pass" | "";
  note: string;
} {
  const carrier =
    detection.ballCarrier && DETECTED_PLAYER_LABELS.includes(detection.ballCarrier as DetectedPlayerLabel)
      ? detection.ballCarrier
      : null;
  const playDir = detection.ballDirection === "left" ? "L" : detection.ballDirection === "right" ? "R" : "";
  const playType = detection.playType === "run" ? "Run" : detection.playType === "pass" ? "Pass" : "";
  const where = detection.ballDirection === "middle" ? "middle" : playDir === "L" ? "left" : playDir === "R" ? "right" : "";
  const note = carrier || where ? `Ball: ${[carrier, where].filter(Boolean).join(", ")} (from film)` : "";
  return { carrier, playDir, playType, note };
}

function isPercentPoint(v: unknown): v is PercentPoint {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Defensive runtime check on a vision model's JSON response before it's
 * trusted — this is still model output, not a schema guarantee. Returns a
 * reason string on failure, or null when valid, in the same
 * never-throw-just-report spirit as `parseHudlCsvText`.
 */
export function validateDetectedPlay(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "Response was not an object";
  const v = value as Record<string, unknown>;
  if (typeof v.playName !== "string") return "Missing playName";
  if (typeof v.formation !== "string") return "Missing formation";
  if (!Array.isArray(v.players) || v.players.length === 0) return "No players detected";
  for (const [i, raw] of v.players.entries()) {
    if (typeof raw !== "object" || raw === null) return `players[${i}] was not an object`;
    const p = raw as Record<string, unknown>;
    if (typeof p.label !== "string" || !p.label) return `players[${i}] missing label`;
    if (!isPercentPoint(p.start)) return `players[${i}] (${p.label}) has an invalid start point`;
    if (!isPercentPoint(p.endpoint)) return `players[${i}] (${p.label}) has an invalid endpoint`;
    if (!Array.isArray(p.waypoints) || !p.waypoints.every(isPercentPoint)) {
      return `players[${i}] (${p.label}) has invalid waypoints`;
    }
  }
  return null;
}

let counter = 0;

/**
 * Turns one detection's players into `routeOverrides` entries, each with
 * `source: "video"` and a raw `path` — the mechanism both
 * `buildCardFromDetection` (a fresh card, no CSV row) and
 * `applyDetectionToCard` (merged onto an existing CSV row, for the batch
 * pipeline) build on. `existing` lets a coach's own overrides on other
 * letters survive being merged with a video detection.
 */
/**
 * Which of the card's letters each detected player is, for a detection in
 * yards: every skill player the model saw is matched to the card's player who
 * lines up closest to where he stood (nearest pair first), so the right route
 * goes on the right man even when the model's letter doesn't match this
 * staff's formation (the lone receiver it called Z is the card's X). Q is
 * always Q. Unmatched detections are dropped rather than guessed.
 */
export function matchDetectedLetters(detection: DetectedPlay, card: HudlPlayCard): Map<DetectedPlayer, string> {
  const players = buildDiagram({ ...card, hash: null, routeOverrides: undefined }, "team", "offense").players.filter(
    (p) => p.label && p.label !== "Q",
  );
  const spots = players.map((p) => ({ label: p.label, x: (p.x - FIELD.center.x) / YARD_X, y: (FIELD.los - p.y) / YARD_PX }));
  const result = new Map<DetectedPlayer, string>();
  const pairs: { player: DetectedPlayer; label: string; d: number }[] = [];
  for (const player of detection.players) {
    if (player.label === "Q") {
      result.set(player, "Q");
      continue;
    }
    for (const spot of spots) {
      pairs.push({ player, label: spot.label, d: Math.hypot(player.start.x - spot.x, player.start.y - spot.y) });
    }
  }
  const taken = new Set<string>();
  for (const { player, label } of pairs.sort((a, b) => a.d - b.d)) {
    if (result.has(player) || taken.has(label)) continue;
    result.set(player, label);
    taken.add(label);
  }
  return result;
}

/**
 * Turns one detection's players into `routeOverrides` entries, each with
 * `source: "video"` and a raw `path` — the mechanism both
 * `buildCardFromDetection` (a fresh card, no CSV row) and
 * `applyDetectionToCard` (merged onto an existing CSV row, for the batch
 * pipeline) build on. `existing` lets a coach's own overrides on other
 * letters survive being merged with a video detection. `card` is the card the
 * routes go on: with a detection in yards, players are matched to its letters
 * by where they lined up (`matchDetectedLetters`).
 */
function detectionToRouteOverrides(
  detection: DetectedPlay,
  card: HudlPlayCard | null,
  existing: HudlPlayCard["routeOverrides"] = {},
): NonNullable<HudlPlayCard["routeOverrides"]> {
  const routeOverrides: NonNullable<HudlPlayCard["routeOverrides"]> = { ...existing };
  const { carrier } = ballFromDetection(detection);
  const yards = detection.units === "yards";
  const letters = yards && card ? matchDetectedLetters(detection, card) : null;
  for (const player of detection.players) {
    const letter = letters ? letters.get(player) : player.label;
    if (!letter || !DETECTED_PLAYER_LABELS.includes(letter as DetectedPlayerLabel)) continue; // unknown role: skip rather than guess
    const path = yards
      ? yardRouteToPathDeltas(player, { across: YARD_X, downfield: YARD_PX })
      : detectedRouteToPathDeltas(player, { width: FIELD.width, height: FIELD.height });
    if (path.length === 0) continue;
    // The ball carrier's arrow says so; everyone else keeps the model's route name.
    const tag = player.label === carrier ? "BALL" : player.routeType?.toUpperCase().slice(0, 10);
    routeOverrides[letter] = { path, source: "video", ...(tag ? { tag } : {}) };
  }
  return routeOverrides;
}

/**
 * Builds a `HudlPlayCard` from one validated detection with no CSV row
 * behind it (the single-clip "Upload game film" flow) — the formation
 * itself is drawn from the AI's own guess (via `classifyFormation`, same as
 * a CSV row's OFF FORM text), and every detected player becomes a
 * `routeOverrides` entry (see `detectionToRouteOverrides`).
 */
export function buildCardFromDetection(
  detection: DetectedPlay,
  source: string,
  playNumber = 1,
): HudlPlayCard {
  const ball = ballFromDetection(detection);
  // Hudl's data bar (the staff's own tags) beats the model's read of the film.
  const bar = hudlBarFields(detection);
  const barPlay = Number.parseInt(bar.playNumber, 10);
  const number = Number.isFinite(barPlay) && barPlay > 0 ? barPlay : playNumber;

  const base: PlaySource = {
    id: `video-${Date.now().toString(36)}-${counter++}`,
    playNumber: number,
    rowIndex: number - 1,
    down: null,
    distance: null,
    isGoalToGo: false,
    yardLine: null,
    yardLineLabel: "—",
    hash: parseHash(bar.hash),
    formation: bar.formation || detection.formation,
    playCall: bar.playCall || detection.playName,
    // Only "Pass" from the film: a run's card stays drawn from the film's own paths, not a blocking scheme.
    playType: bar.playType || (ball.playType === "Pass" ? "Pass" : ""),
    defFront: "",
    result: "",
    coverage: "",
    offStrength: bar.offStrength,
    playDir: bar.playDir || ball.playDir,
    notes: ball.note,
    source,
    raw: {},
  };

  const card = deriveCard(base);
  return deriveCard({ ...base, routeOverrides: detectionToRouteOverrides(detection, card) });
}

/**
 * Merges a video detection onto an existing (CSV-derived) card, for the
 * batch pipeline: unlike `buildCardFromDetection`, this keeps the card's
 * real down/distance/formation/play call from Hudl — the CSV is ground
 * truth there — and only fills in each detected letter's route, the one
 * thing the CSV can't tell you. Any of the card's own `routeOverrides` on
 * other letters (a coach's manual edit, say) are preserved.
 */
export function applyDetectionToCard(card: HudlPlayCard, detection: DetectedPlay): HudlPlayCard {
  const ball = ballFromDetection(detection);
  return updateCard(card, {
    routeOverrides: detectionToRouteOverrides(detection, card, card.routeOverrides),
    // The CSV is ground truth: the film only fills a PLAY DIR or note the row left blank.
    ...(!card.playDir.trim() && ball.playDir ? { playDir: ball.playDir } : {}),
    ...(!card.notes.trim() && ball.note ? { notes: ball.note } : {}),
  });
}

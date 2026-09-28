/**
 * Turns a validated vision-model detection (see `/api/parse-video`) into a
 * real `HudlPlayCard`, the same shape a CSV row produces — so a video-derived
 * card flows through the exact same script/print/filter/storage pipeline as
 * every other card. Framework-free, so it's directly unit-testable.
 */

import { FIELD } from "./formations";
import { detectedRouteToPathDeltas, type PercentPoint } from "./coordinateMapper";
import { deriveCard, type HudlPlayCard, type PlaySource } from "./hudlParser";

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
 * Builds a `HudlPlayCard` from one validated detection. Every detected
 * player becomes a `routeOverrides` entry with `source: "video"` and a raw
 * `path`, so it draws through the exact same override mechanism a coach's
 * own route edit uses (see `formations.ts`'s `buildDiagram`) — the
 * formation itself is drawn in its normal, canonical shape; only each
 * letter's route line is video-derived.
 */
export function buildCardFromDetection(
  detection: DetectedPlay,
  source: string,
  playNumber = 1,
): HudlPlayCard {
  const routeOverrides: NonNullable<HudlPlayCard["routeOverrides"]> = {};
  for (const player of detection.players) {
    if (!DETECTED_PLAYER_LABELS.includes(player.label as DetectedPlayerLabel)) continue; // unlabeled/unknown role: skip rather than guess
    const path = detectedRouteToPathDeltas(player, { width: FIELD.width, height: FIELD.height });
    if (path.length === 0) continue;
    routeOverrides[player.label] = {
      path,
      source: "video",
      ...(player.routeType ? { tag: player.routeType.toUpperCase().slice(0, 10) } : {}),
    };
  }

  const base: PlaySource = {
    id: `video-${Date.now().toString(36)}-${counter++}`,
    playNumber,
    rowIndex: playNumber - 1,
    down: null,
    distance: null,
    isGoalToGo: false,
    yardLine: null,
    yardLineLabel: "—",
    hash: null,
    formation: detection.formation,
    playCall: detection.playName,
    playType: "",
    defFront: "",
    result: "",
    coverage: "",
    offStrength: "",
    playDir: "",
    notes: "",
    source,
    routeOverrides,
    raw: {},
  };

  return deriveCard(base);
}

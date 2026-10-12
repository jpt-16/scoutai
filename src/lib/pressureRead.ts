/**
 * The blitz from film, in this staff's words (`pressure.ts`): who rushed in the first `RUSH_SECONDS` after the snap.
 * A down lineman who stayed at the line rushed (one who ran back into coverage dropped); a backer, nickel or DB who
 * reached the line blitzed. Where a blitzer crossed it says which: outside the tackle (`EDGE_YARDS`) is an outside
 * backer's FIRE, inside it an LB blitz; both outside backers is DOUBLE FIRE. The count of everyone who rushed is the
 * number the staff writes first ("6 - DOUBLE FIRE").
 *
 * The defense at the snap has to add up (`readDefense` plausible) for the read to be sure; on the low sideline
 * recordings it doesn't, so nothing is written there. Tested on drawn plays (`pressureRead.test.ts`).
 */

import { deriveCard, type HudlPlayCard } from "./hudlParser";
import { readDefense, type DefRole } from "./defenseRead";
import { parsePressure, pressureTag, type Blitzer } from "./pressure";
import { snapTime, type TrackedPlayer, type TrackedPlayFile } from "./trackedPlay";

/** A blitz has shown itself by now. */
const RUSH_SECONDS = 1.5;
/** Reaching this close to the line (yards past it, or behind it) is rushing. */
const AT_LINE_YARDS = 1.0;
/** A down lineman who got this far back off the line dropped into coverage. */
const DROP_YARDS = 4;
/** Crossing the line this far from the ball or wider is off the edge (the tackle stands about 4.7 yards out). */
const EDGE_YARDS = 4.5;
/** Points this close in time to a moment stand for where he was then. */
const NEAR_SECONDS = 0.25;

export interface PressureRead {
  /** Everyone who rushed. */
  rushers: number;
  /** The backers (and DBs) who blitzed, and how. */
  blitzers: { role: DefRole; how: Blitzer | "db" }[];
  /** The staff's tag ("6 - DOUBLE FIRE"), or null for a straight four-man rush. */
  tag: string | null;
  sure: boolean;
  evidence: string[];
}

function at(track: TrackedPlayer, t: number): { x: number; y: number } | null {
  let best: [number, number, number] | null = null;
  for (const p of track.points) if (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
  return best && Math.abs(best[0] - t) <= NEAR_SECONDS ? { x: best[1], y: best[2] } : null;
}

/** Where his path first reached the line within the window, or null if it never did. */
function reachedLine(track: TrackedPlayer, from: number, to: number): { x: number; y: number } | null {
  const p = track.points.find(([s, , y]) => s >= from && s <= to && y <= AT_LINE_YARDS);
  return p ? { x: p[1], y: p[2] } : null;
}

/** The blitz, or null when the defense at the snap couldn't be read. */
export function readPressure(file: TrackedPlayFile): PressureRead | null {
  const snap = snapTime(file);
  const pre = readDefense(file);
  if (!pre) return null;
  const end = snap + RUSH_SECONDS;
  // The formation's strong side: the side with more receivers at the snap.
  const right = pre.receivers.filter((r) => r.x > 0).length;
  const left = pre.receivers.length - right;
  const strongDir = right > left ? 1 : right < left ? -1 : 1;

  let rushers = 0;
  let dropped = 0;
  const blitzers: PressureRead["blitzers"] = [];
  for (const track of file.tracks.filter((t) => t.team === "defense")) {
    const start = at(track, snap);
    if (!start) continue;
    const def = pre.defenders
      .filter((d) => Math.hypot(d.x - start.x, d.y - start.y) < 1)
      .sort((a, b) => Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y))[0];
    if (!def) continue;
    const later = at(track, end);
    if (def.role === "dl") {
      if (later && later.y - start.y >= DROP_YARDS) dropped++;
      else rushers++;
      continue;
    }
    const crossed = reachedLine(track, snap, end);
    if (!crossed) continue;
    rushers++;
    if (def.role === "cb" || def.role === "s") {
      blitzers.push({ role: def.role, how: "db" });
      continue;
    }
    const edge = Math.abs(crossed.x) >= EDGE_YARDS;
    const how: Blitzer = edge ? (Math.sign(crossed.x) === strongDir ? "outside-strong" : "outside-weak") : "inside";
    blitzers.push({ role: def.role, how });
  }

  const backers = blitzers.map((b) => b.how).filter((h): h is Blitzer => h !== "db");
  const tag = blitzers.length ? (pressureTag(rushers, backers) ?? `${rushers} - BLITZ`) : null;
  const evidence = [
    `${rushers} rushed${dropped ? `, ${dropped} down lineman dropped into coverage` : ""}`,
    ...blitzers.map((b) => `${b.role.toUpperCase()} blitzed ${b.how === "inside" ? "inside" : b.how === "db" ? "from the secondary" : "off the edge"}`),
  ];
  if (!pre.plausible) evidence.push(`the defense at the snap doesn't add up (${pre.label})`);
  return { rushers, blitzers, tag, sure: pre.plausible, evidence };
}

/**
 * A card with the film's blitz: the COVERAGE column is where this staff writes it, so a sure blitz is written there
 * when the sheet left it blank (the coach's tag wins), and noted either way.
 */
export function applyPressureRead(card: HudlPlayCard, read: PressureRead | null): HudlPlayCard {
  if (!read?.tag) return card;
  const described = parsePressure(read.tag)?.describe ?? `${read.tag}.`;
  const note = read.sure ? `Film blitz: ${described}` : `Check blitz: film says ${read.tag}, unsure.`;
  const notes = [card.notes, note].filter(Boolean).join(" ");
  const coverage = !card.coverage.trim() && read.sure ? read.tag : card.coverage;
  return deriveCard({ ...card, coverage, notes });
}

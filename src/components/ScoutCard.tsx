"use client";

import { useId, useRef, useState } from "react";
import type { HudlPlayCard, InkStroke } from "@/lib/hudlParser";
import {
  buildAssignments,
  buildDiagram,
  FIELD,
  fromCardPoint,
  NUMBERS_X,
  PLAY_KIND_LABELS,
  type DiagramMode,
  type Point,
  type ScoutUnit,
} from "@/lib/formations";
import { formationSharePct, preferredDirection, situationRunPct, type ScriptTendencies } from "@/lib/tendencies";
import { cn } from "@/lib/utils";

export type ScoutCardVariant = "field" | "print";

interface ScoutCardProps {
  card: HudlPlayCard;
  /** `field` = the iPad card (color). `print` = tuned for paper and grayscale. */
  variant?: ScoutCardVariant;
  /** `team` = all 11; `7v7` = skeleton, no linemen on either side. */
  mode?: DiagramMode;
  /** `offense` = scout offense (blocking, routes); `defense` = formation + defensive alignment. */
  unit?: ScoutUnit;
  /**
   * Scout defense: lets a coach drag the X's to where the defense lined up on
   * film. Called on release with the defender id and its saved position.
   */
  onMoveDefender?: (id: string, at: Point) => void;
  /**
   * Makes the assignment table editable: tap a box and type. Called on blur
   * with the box key ("PST", "Y", "NOTES") and the new text ("" = back to auto).
   */
  onAssignmentChange?: (key: string, text: string) => void;
  /**
   * Turns on drawing (Apple Pencil or finger) over the field. Each finished
   * stroke is handed to `onStroke`; saved strokes come from `card.drawings`.
   */
  ink?: { color: string; width?: number; onStroke: (stroke: InkStroke) => void };
  /**
   * Lets a coach drag the break points of an AI-detected route (a
   * `routeOverrides` entry with `source: "video"`) to correct it. Called on
   * release with the letter and its full updated path (see
   * `RouteOverride.path` — deltas from the player's own position).
   */
  onEditDetectedRoute?: (letter: string, path: [number, number][], route?: string) => void;
  /**
   * With `onEditDetectedRoute`, puts a draggable handle on every break point of
   * every route (Scout O), not just film and AI routes. A route the play call
   * drew becomes the coach's own shape, keeping its number (`route`).
   */
  adjustRoutes?: boolean;
  /**
   * Scout-report tendencies for the whole loaded script (see
   * `src/lib/tendencies.ts`), computed once by the caller and handed to
   * every card — `ScoutCard` only reads this one card's own slice of it
   * (its formation's share, its down/distance situation's run%, and the
   * script's overall preferred direction). Field variant only; omitted
   * shows no badge row, so most callers (the landing-page preview, Print
   * Grid) render exactly as before.
   */
  tendencies?: ScriptTendencies;
  /**
   * `high` = sunlight mode: pure black on white, lines half again as thick,
   * no color at all, for field screens (iPad, The CoachPad) in direct sun.
   */
  contrast?: "normal" | "high";
  className?: string;
}

/** White-field diagram palettes (PlayIQ-style): black players, blue LOS, red routes. */
const PALETTES = {
  field: {
    card: "#ffffff",
    ink: "#111111",
    muted: "#52525b",
    rule: "#d4d4d8",
    box: "#f4f4f5",
    field: "#ffffff",
    grid: "#d4d4d8",
    hash: "#a1a1aa",
    numbers: "#b8b8c0",
    los: "#2563eb",
    offense: "#111111",
    offenseFill: "#ffffff",
    block: "#111111",
    route: "#dc2626",
    ball: "#ea580c",
    defense: "#dc2626",
    badgeBg: "#111111",
    badgeInk: "#ffffff",
  },
  print: {
    card: "#ffffff",
    ink: "#111111",
    muted: "#3f3f46",
    rule: "#111111",
    box: "#ffffff",
    field: "#ffffff",
    grid: "#c8c8cc",
    hash: "#8a8a93",
    numbers: "#a8a8b0",
    los: "#1d4ed8",
    offense: "#111111",
    offenseFill: "#ffffff",
    block: "#111111",
    route: "#b91c1c",
    ball: "#c2410c",
    defense: "#b91c1c",
    badgeBg: "#111111",
    badgeInk: "#ffffff",
  },
} as const;

/** Sunlight mode: everything black on white, grid still readable but faint. */
const SUNLIGHT = {
  card: "#ffffff",
  ink: "#000000",
  muted: "#000000",
  rule: "#000000",
  box: "#ffffff",
  field: "#ffffff",
  grid: "#8c8c8c",
  hash: "#5c5c5c",
  numbers: "#8c8c8c",
  los: "#000000",
  offense: "#000000",
  offenseFill: "#ffffff",
  block: "#000000",
  route: "#000000",
  ball: "#000000",
  defense: "#000000",
  badgeBg: "#000000",
  badgeInk: "#ffffff",
} as const;

/** Card aspect ratio (width / height) shared with layouts that size cards. */
export const SCOUT_CARD_ASPECT = 760 / 600;

/**
 * Offense symbol sizes (SVG units). Skill players sit at y 150 and linemen at 148, so with these
 * radii every on-ball front edge lands on y 141, the LOS bar's back edge. The center is a square
 * of side 2 * LINE_R.
 */
const SKILL_R = 9;
const LINE_R = 7;

const f = (n: number) => n.toFixed(1);

/** Unit vector of a segment. */
function heading(from: Point, to: Point) {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  return { cos: Math.cos(a), sin: Math.sin(a) };
}

/**
 * Straight segments with sharp corners, starting at the player's circle edge
 * and ending `endInset` short of the last point (room for an arrow marker).
 */
function linePath(path: Point[], endInset: number): string {
  const [first, second] = path;
  const tip = path[path.length - 1];
  const s = heading(first, second);
  const e = heading(path[path.length - 2], tip);
  const start = { x: first.x + 12 * s.cos, y: first.y + 12 * s.sin };
  const end = { x: tip.x - endInset * e.cos, y: tip.y - endInset * e.sin };
  const middle = path
    .slice(1, -1)
    .map((p) => ` L ${f(p.x)} ${f(p.y)}`)
    .join("");
  return `M ${f(start.x)} ${f(start.y)}${middle} L ${f(end.x)} ${f(end.y)}`;
}

/**
 * A smooth route (a bubble's arc): quadratic curves through the midpoints of
 * the path's legs, starting at the player's circle edge and ending
 * `endInset` short of the last point, so the arrow sits on the curve's own heading.
 */
function curvePath(path: Point[], endInset: number): string {
  if (path.length < 3) return linePath(path, endInset);
  const tip = path[path.length - 1];
  const s = heading(path[0], path[1]);
  const e = heading(path[path.length - 2], tip);
  const start = { x: path[0].x + 12 * s.cos, y: path[0].y + 12 * s.sin };
  const end = { x: tip.x - endInset * e.cos, y: tip.y - endInset * e.sin };
  let d = `M ${f(start.x)} ${f(start.y)}`;
  for (let i = 1; i < path.length - 1; i++) {
    const next =
      i === path.length - 2 ? end : { x: (path[i].x + path[i + 1].x) / 2, y: (path[i].y + path[i + 1].y) / 2 };
    d += ` Q ${f(path[i].x)} ${f(path[i].y)} ${f(next.x)} ${f(next.y)}`;
  }
  return d;
}

/** Block symbol: the line, then a T-bar across its end. */
function blockPath(path: Point[]): string {
  const tip = path[path.length - 1];
  const { cos, sin } = heading(path[path.length - 2], tip);
  const px = -sin * 7;
  const py = cos * 7;
  return `${linePath(path, 0)} M ${f(tip.x + px)} ${f(tip.y + py)} L ${f(tip.x - px)} ${f(tip.y - py)}`;
}

/** Keeps a label on the field when a route ends near an edge. */
const onField = (p: Point) => ({
  x: Math.min(FIELD.width - 14, Math.max(14, p.x)),
  y: Math.min(FIELD.height - 10, Math.max(12, p.y)),
});

/**
 * A scout card: title header, a white-field SVG diagram (offense with blocking
 * and routes, or the formation plus defensive alignment), and an assignment
 * table. Scales with its container width via container-query units.
 */
export function ScoutCard({
  card,
  variant = "field",
  mode = "team",
  unit = "offense",
  onMoveDefender,
  onAssignmentChange,
  ink,
  onEditDetectedRoute,
  adjustRoutes = false,
  tendencies,
  contrast = "normal",
  className,
}: ScoutCardProps) {
  const sunlight = contrast === "high";
  const c = sunlight ? SUNLIGHT : PALETTES[variant];
  /** Line weight: half again as thick in sunlight mode. */
  const w = (n: number) => (sunlight ? n * 1.5 : n);
  const diagram = buildDiagram(card, mode, unit);
  const rows = buildAssignments(card, diagram);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [stroke, setStroke] = useState<[number, number][] | null>(null);
  // Live-drag state for a video-detected route's break point (index within
  // that route's own path, 1-based — index 0 is the player, never draggable).
  /** The player whose route gets handles: film / AI routes always, any route while adjusting. */
  const handleLetter = (i: number) =>
    diagram.routeVideoLetters[i] ?? (adjustRoutes ? diagram.routeLetters[i] : null);
  const [routeDrag, setRouteDrag] = useState<{ letter: string; pointIndex: number; x: number; y: number } | null>(
    null,
  );
  const strokes = card.drawings?.[unit] ?? [];
  const movable = Boolean(onMoveDefender) && unit === "defense";
  const isDefense = unit === "defense";
  const cardNumber = String(card.playNumber).padStart(2, "0");
  const title = isDefense
    ? `${card.formation || "—"} vs ${card.defFront || "4-3"}`
    : `${card.formation || "—"} · ${diagram.routeSummary ?? (card.playCall || "—")}`;
  const subtitle = [
    card.hash ? `${card.hash} hash` : null,
    mode === "7v7" ? "7v7" : "Team",
    isDefense ? "Scout defense" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const tag = isDefense ? "DEF" : PLAY_KIND_LABELS[diagram.kind];
  const tagColor = isDefense ? c.defense : diagram.kind === "run" ? c.ball : c.los;
  const marker = (name: string) => `url(#${uid}-${name})`;

  // Tendency badges: only on the field variant, and only once there's a
  // script's worth of plays to compute them from (see src/lib/tendencies.ts).
  const shareBadge = tendencies && variant === "field" ? formationSharePct(tendencies, card) : null;
  const runBadge = tendencies && variant === "field" ? situationRunPct(tendencies, card) : null;
  const directionBadge = tendencies && variant === "field" ? preferredDirection(tendencies) : null;
  const hasBadges = shareBadge != null || runBadge != null || directionBadge != null;

  /** Pointer positions in SVG coordinates, including the Pencil's in-between samples. */
  const inkPoints = (e: React.PointerEvent): [number, number][] => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return [];
    const inv = m.inverse();
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    return (events.length ? events : [e.nativeEvent]).map((ev) => {
      const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(inv);
      return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
    });
  };
  const inkPath = (points: [number, number][]) =>
    points.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ");

  /** Pointer position in SVG coordinates, kept on the field and on the defense's side. */
  const svgPoint = (e: React.PointerEvent): Point | null => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const [minY, maxY] = diagram.flipped
      ? [diagram.losY + 6, FIELD.height - 8]
      : [8, diagram.losY - 6];
    return {
      x: Math.min(FIELD.width - 10, Math.max(10, p.x)),
      y: Math.min(maxY, Math.max(minY, p.y)),
    };
  };

  // Assignment grid: 4 columns (3 for scout defense); NOTES fills the last row.
  const columns = rows.length <= 3 ? 3 : 4;
  const notesSpan = columns - ((rows.length - 1) % columns);

  return (
    <article
      aria-label={`Card ${cardNumber}: ${title}`}
      className={cn(
        "@container flex aspect-[760/600] w-full flex-col overflow-hidden border-2",
        variant === "print" ? "rounded-md" : "rounded-[14px]",
        className,
      )}
      style={
        {
          background: c.card,
          color: c.ink,
          borderColor: variant === "print" ? c.ink : c.rule,
          "--sc-muted": c.muted,
        } as React.CSSProperties
      }
    >
      {/* Header: card number, centered play title, run/pass tag. */}
      <header
        className="grid h-[max(46px,8.5cqw)] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[max(8px,1.6cqw)] border-b-2 px-[max(8px,1.6cqw)]"
        style={{ borderColor: c.rule }}
      >
        <div
          className="flex flex-col items-center justify-center rounded-md px-[max(6px,1.2cqw)] py-[max(2px,0.4cqw)]"
          style={{ background: c.badgeBg, color: c.badgeInk }}
        >
          <span className="text-[max(8px,1.25cqw)] leading-none font-bold tracking-[0.12em]">
            CARD
          </span>
          <span className="font-display text-[max(18px,3.6cqw)] leading-[0.95] font-extrabold">
            {cardNumber}
          </span>
        </div>
        <div className="flex min-w-0 flex-col items-center text-center">
          <h3 className="font-display w-full truncate text-[max(16px,3.7cqw)] leading-tight font-extrabold uppercase">
            {title}
          </h3>
          <span
            className="text-[max(9px,1.45cqw)] font-semibold tracking-[0.06em] uppercase"
            style={{ color: c.muted }}
          >
            {subtitle}
          </span>
        </div>
        <span
          className="font-display rounded-md border-2 px-[max(6px,1.1cqw)] py-[max(1px,0.3cqw)] text-[max(12px,2.2cqw)] font-extrabold whitespace-nowrap"
          style={{ color: tagColor, borderColor: tagColor }}
        >
          {tag}
        </span>
      </header>

      {hasBadges && (
        <div
          className="flex flex-wrap items-center gap-[max(4px,0.8cqw)] border-b-2 px-[max(8px,1.6cqw)] py-[max(3px,0.7cqw)]"
          style={{ borderColor: c.rule }}
        >
          {shareBadge != null && (
            <span
              className="rounded-full px-[max(6px,1.2cqw)] py-[max(1px,0.35cqw)] text-[max(8px,1.35cqw)] leading-none font-bold tracking-[0.03em] whitespace-nowrap"
              style={{ background: c.badgeBg, color: c.badgeInk }}
            >
              {card.formation || "Formation"} · {shareBadge}% usage
            </span>
          )}
          {runBadge != null && (
            <span
              className="rounded-full px-[max(6px,1.2cqw)] py-[max(1px,0.35cqw)] text-[max(8px,1.35cqw)] leading-none font-bold tracking-[0.03em] whitespace-nowrap"
              style={{ background: runBadge >= 50 ? c.ball : c.los, color: "#ffffff" }}
            >
              {runBadge >= 50 ? runBadge : 100 - runBadge}% {runBadge >= 50 ? "RUN" : "PASS"} THIS DOWN/DIST
            </span>
          )}
          {directionBadge != null && (
            <span
              className="rounded-full px-[max(6px,1.2cqw)] py-[max(1px,0.35cqw)] text-[max(8px,1.35cqw)] leading-none font-bold tracking-[0.03em] whitespace-nowrap"
              style={{ background: c.badgeBg, color: c.badgeInk }}
            >
              {directionBadge.side === "left" ? "←" : "→"} {directionBadge.pct}%{" "}
              {directionBadge.side.toUpperCase()}
            </span>
          )}
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${FIELD.width} ${FIELD.height}`}
        preserveAspectRatio="xMidYMid meet"
        // Never select text on a long press; while dragging X's or drawing, the page
        // doesn't scroll under the finger or Pencil either.
        className={cn("block min-h-0 w-full flex-1 select-none", (movable || ink) && "touch-none")}
        style={{ background: c.field }}
        role="img"
        aria-label={
          isDefense ? "Formation and defensive alignment" : "Offensive formation and assignments"
        }
      >
        <defs>
          {(
            [
              ["route", c.route],
              ["ball", c.ball],
              ["block", c.block],
            ] as const
          ).map(([name, color]) => (
            <marker
              key={name}
              id={`${uid}-${name}`}
              viewBox="0 0 10 10"
              refX={8}
              refY={5}
              markerWidth={3.2}
              markerHeight={3.2}
              orient="auto-start-reverse"
            >
              {/* A narrower arrowhead than a full-height triangle (base inset from the marker's edges). */}
              <path d="M 1.5 1.5 L 10 5 L 1.5 8.5 Z" fill={color} />
            </marker>
          ))}
        </defs>

        {/* Field: 5-yard lines, hash marks (left, middle, right), field numbers. */}
        <rect x={0} y={0} width={FIELD.width} height={FIELD.height} fill={c.field} />
        <g stroke={c.grid} strokeWidth={1.5}>
          {diagram.yardLines.map(({ y }) => (
            <line key={y} x1={0} x2={FIELD.width} y1={y} y2={y} />
          ))}
        </g>
        <g stroke={c.hash} strokeWidth={1.5}>
          {diagram.hashTicks.map((y) => (
            <g key={y}>
              <line x1={FIELD.hashX.L - 5} x2={FIELD.hashX.L + 5} y1={y} y2={y} />
              <line
                x1={FIELD.hashX.M - 3}
                x2={FIELD.hashX.M + 3}
                y1={y}
                y2={y}
                strokeOpacity={0.5}
              />
              <line x1={FIELD.hashX.R - 5} x2={FIELD.hashX.R + 5} y1={y} y2={y} />
            </g>
          ))}
        </g>
        <g
          fill={c.numbers}
          fontSize={22}
          fontWeight={800}
          fontFamily="'Barlow Condensed', sans-serif"
          textAnchor="middle"
          stroke={c.field}
          strokeWidth={5}
          paintOrder="stroke"
          aria-hidden="true"
        >
          {diagram.yardLines
            .filter((l) => l.label)
            .flatMap(({ y, label }) =>
              [NUMBERS_X.left, NUMBERS_X.right].map((x) => (
                // Turned 90° to face their own sideline, like a real field: the
                // yard line runs between the two digits.
                <text
                  key={`${x}-${y}`}
                  x={x}
                  y={y}
                  dy="0.36em"
                  letterSpacing={6}
                  transform={`rotate(${x < FIELD.center.x ? 90 : -90} ${x} ${y})`}
                >
                  {label}
                </text>
              )),
            )}
        </g>

        {/* Line of scrimmage. */}
        {/* The LOS bar sits just in front of the line (y 136-141 offense view), so every on-ball
            player's front edge (skill players at 150 less SKILL_R, linemen at 148 less LINE_R) is
            flush with its back edge. */}
        <rect x={0} y={diagram.flipped ? diagram.losY - 1 : diagram.losY - 4} width={FIELD.width} height={5} fill={c.los} />

        {/* Blocks, pulls, fakes, routes, ball carrier. */}
        <g fill="none" stroke={c.block} strokeWidth={w(2.2)} strokeLinecap="butt" strokeLinejoin="miter">
          {diagram.blocks.map((b, i) => (
            <path key={i} d={blockPath(b)} />
          ))}
          {diagram.targetBlocks.map(({ path }, i) => (
            <path key={`t${i}`} d={blockPath(path)} strokeWidth={w(2.5)} />
          ))}
          {diagram.pulls.map((p, i) => (
            <path key={`p${i}`} d={linePath(p, 3)} markerEnd={marker("block")} />
          ))}
        </g>
        {diagram.targetBlocks.map(({ path, target }, i) => {
          const tip = path[path.length - 1];
          const { cos, sin } = heading(path[path.length - 2], tip);
          return (
            <text
              key={`tl${i}`}
              x={tip.x + cos * 15}
              y={tip.y + sin * 15}
              dy="0.36em"
              textAnchor="middle"
              fontSize={12}
              fontWeight={800}
              fontFamily="'Barlow Condensed', sans-serif"
              fill={c.ink}
              stroke={c.field}
              strokeWidth={3}
              paintOrder="stroke"
            >
              {target}
            </text>
          );
        })}
        <g fill="none" strokeLinejoin="miter" strokeLinecap="butt">
          {diagram.fakes.map((p, i) => (
            <path
              key={`f${i}`}
              d={linePath(p, 3)}
              stroke={c.ball}
              strokeWidth={w(2.2)}
              strokeDasharray="7 6"
              markerEnd={marker("ball")}
            />
          ))}
          {diagram.routes.map((p, i) => {
            const letter = handleLetter(i);
            // While a break point is being dragged, preview the path live.
            const drag = routeDrag && letter && routeDrag.letter === letter ? routeDrag : null;
            const live = drag ? p.map((pt, j) => (j === drag.pointIndex ? { x: drag.x, y: drag.y } : pt)) : p;
            return (
              <path
                key={`r${i}`}
                d={diagram.routeCurves[i] ? curvePath(live, 3) : linePath(live, 3)}
                stroke={c.route}
                strokeWidth={w(2.5)}
                markerEnd={marker("route")}
              />
            );
          })}
          {diagram.carrier && (
            <path
              d={linePath(diagram.carrier, 3)}
              stroke={c.ball}
              strokeWidth={w(3)}
              // In black and white the ball carrier reads as a long dash.
              strokeDasharray={sunlight ? "14 4" : undefined}
              markerEnd={marker("ball")}
            />
          )}
        </g>
        {diagram.routes.map((p, i) => {
          const label = diagram.routeLabels[i];
          if (!label) return null;
          const tip = p[p.length - 1];
          const { cos, sin } = heading(p[p.length - 2], tip);
          // Past the arrow tip, unless that sits on a player: then above, below,
          // or beside the last leg of the route, whichever is clear.
          const before = p[p.length - 2];
          const clear = (q: Point) =>
            !diagram.players.some((pl) => Math.hypot(pl.x - q.x, pl.y - q.y) < 20);
          const at =
            [
              { x: tip.x + cos * 16, y: tip.y + sin * 16 },
              { x: tip.x, y: tip.y - 18 },
              { x: tip.x, y: tip.y + 18 },
              { x: (tip.x + before.x) / 2, y: (tip.y + before.y) / 2 - 14 },
              { x: (tip.x + before.x) / 2, y: (tip.y + before.y) / 2 + 14 },
            ]
              .map(onField)
              .find(clear) ?? onField({ x: tip.x + cos * 16, y: tip.y + sin * 16 });
          return (
            <text
              key={`l${i}`}
              x={at.x}
              y={at.y}
              dy="0.36em"
              textAnchor="middle"
              fontSize={/^\d$/.test(label) ? 17 : 11}
              fontWeight={800}
              fontFamily="'Barlow Condensed', sans-serif"
              fill={c.route}
              stroke={c.field}
              strokeWidth={3.5}
              paintOrder="stroke"
            >
              {label}
            </text>
          );
        })}

        {/* AI-detected routes: draggable handles at each break point. */}
        {onEditDetectedRoute &&
          diagram.routes.map((p, i) => {
            const letter = handleLetter(i);
            if (!letter) return null;
            return p.slice(1).map((point, k) => {
              const pointIndex = k + 1; // index within `p`; 0 is the player, never draggable
              const drag =
                routeDrag && routeDrag.letter === letter && routeDrag.pointIndex === pointIndex
                  ? routeDrag
                  : null;
              const at = drag ? { x: drag.x, y: drag.y } : point;
              return (
                <g
                  key={`vr${i}-${pointIndex}`}
                  role="button"
                  aria-label={`Adjust ${letter}'s route`}
                  style={{ cursor: "grab", touchAction: "none" }}
                  onPointerDown={(e) => {
                    e.stopPropagation(); // keep the card's swipe from seeing this touch
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const pt = svgPoint(e);
                    if (pt) setRouteDrag({ letter, pointIndex, ...pt });
                  }}
                  onPointerMove={(e) => {
                    if (!drag) return;
                    const pt = svgPoint(e);
                    if (pt) setRouteDrag({ letter, pointIndex, ...pt });
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    if (drag) {
                      const raw = fromCardPoint(diagram, { x: drag.x, y: drag.y });
                      const player = diagram.players.find((pl) => pl.label === letter);
                      const startRaw = player && fromCardPoint(diagram, player);
                      // The shape as drawn now, as deltas from his own spot (a route the play
                      // call drew has no saved path yet, so read it off the card).
                      const saved = card.routeOverrides?.[letter]?.path;
                      const original: [number, number][] =
                        saved && saved.length === p.length - 1
                          ? saved
                          : p.slice(1).map((pt) => {
                              const r = fromCardPoint(diagram, pt);
                              return [r.x - (startRaw?.x ?? 0), r.y - (startRaw?.y ?? 0)] as [number, number];
                            });
                      if (startRaw) {
                        const updated = original.map((delta, idx) =>
                          idx === pointIndex - 1
                            ? ([raw.x - startRaw.x, raw.y - startRaw.y] as [number, number])
                            : delta,
                        );
                        onEditDetectedRoute(letter, updated, diagram.routeKinds[i] ?? undefined);
                      }
                    }
                    setRouteDrag(null);
                  }}
                  onPointerCancel={() => setRouteDrag(null)}
                >
                  {/* A bigger invisible target, so a fingertip finds the point. */}
                  <circle cx={at.x} cy={at.y} r={18} fill="transparent" />
                  <circle
                    cx={at.x}
                    cy={at.y}
                    r={drag ? 11 : 9}
                    fill={c.route}
                    fillOpacity={drag ? 0.9 : 0.55}
                    stroke={c.field}
                    strokeWidth={2}
                  />
                </g>
              );
            });
          })}

        {/* Scout defense: X's (draggable while adjusting). */}
        {diagram.defense.map((d) => {
          const p = drag?.id === d.id ? { ...d, x: drag.x, y: drag.y } : d;
          return (
            <g
              key={d.id}
              {...(movable && {
                role: "button",
                "aria-label": `Move ${d.label}`,
                style: { cursor: "grab", touchAction: "none" },
                onPointerDown: (e: React.PointerEvent<SVGGElement>) => {
                  // Keep the card's swipe from seeing this touch.
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const at = svgPoint(e);
                  if (at) setDrag({ id: d.id, ...at });
                },
                onPointerMove: (e: React.PointerEvent<SVGGElement>) => {
                  if (drag?.id !== d.id) return;
                  const at = svgPoint(e);
                  if (at) setDrag({ id: d.id, ...at });
                },
                onPointerUp: (e: React.PointerEvent<SVGGElement>) => {
                  e.stopPropagation();
                  if (drag?.id === d.id) onMoveDefender?.(d.id, fromCardPoint(diagram, drag));
                  setDrag(null);
                },
                onPointerCancel: () => setDrag(null),
              })}
            >
              {movable && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={17}
                  fill={c.defense}
                  fillOpacity={drag?.id === d.id ? 0.25 : 0.1}
                  stroke={c.defense}
                  strokeOpacity={0.6}
                  strokeDasharray="3 3"
                />
              )}
              <path
                d={`M ${p.x - 7} ${p.y - 7} L ${p.x + 7} ${p.y + 7} M ${p.x + 7} ${p.y - 7} L ${p.x - 7} ${p.y + 7}`}
                stroke={c.defense}
                strokeWidth={w(3.5)}
                strokeLinecap="round"
              />
              <text
                x={p.x}
                y={diagram.flipped ? p.y + 20 : p.y - 12}
                textAnchor="middle"
                fontSize={11}
                fontWeight={800}
                fontFamily="'Barlow Condensed', sans-serif"
                fill={c.defense}
              >
                {p.label}
              </text>
            </g>
          );
        })}

        {/* Offense: square center, circles for everyone else, letters on skill players. */}
        {diagram.players.map((p, i) =>
          p.ball ? (
                <rect
              key={i}
              x={p.x - LINE_R}
              y={p.y - LINE_R}
              width={LINE_R * 2}
              height={LINE_R * 2}
              fill={c.offenseFill}
              stroke={c.offense}
              strokeWidth={w(2.5)}
            />
          ) : (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r={p.label ? SKILL_R : LINE_R}
                fill={c.offenseFill}
                stroke={c.offense}
                strokeWidth={w(2.5)}
              />
              {p.label && (
                <text
                  x={p.x}
                  y={p.y}
                  dy="0.36em"
                  textAnchor="middle"
                  fontSize={SKILL_R + 2}
                  fontWeight={800}
                  fontFamily="'Barlow Condensed', sans-serif"
                  fill={c.offense}
                >
                  {p.label}
                </text>
              )}
            </g>
          ),
        )}

        {/* Coach drawings (Pencil), then the live stroke. */}
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {strokes.map((st, i) => (
            <path
              key={`ink${i}`}
              d={inkPath(st.points.length === 1 ? [st.points[0], st.points[0]] : st.points)}
              stroke={st.color}
              strokeWidth={st.width}
            />
          ))}
          {stroke && ink && (
            <path d={inkPath(stroke)} stroke={ink.color} strokeWidth={ink.width ?? 3.5} />
          )}
        </g>
        {ink && (
          <rect
            x={0}
            y={0}
            width={FIELD.width}
            height={FIELD.height}
            fill="transparent"
            style={{ touchAction: "none", cursor: "crosshair" }}
            aria-label="Drawing area"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              setStroke(inkPoints(e));
            }}
            onPointerMove={(e) => {
              if (!stroke) return;
              const next = inkPoints(e);
              const [lx, ly] = stroke[stroke.length - 1] ?? [0, 0];
              // Skip samples closer than ~1 px to keep saved strokes small.
              const far = next.filter(([x, y]) => Math.hypot(x - lx, y - ly) > 1);
              if (far.length) setStroke([...stroke, ...far]);
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              if (stroke?.length) {
                ink.onStroke({ color: ink.color, width: ink.width ?? 3.5, points: stroke });
              }
              setStroke(null);
            }}
            onPointerCancel={() => setStroke(null)}
          />
        )}
      </svg>

      {/* Assignment table: generated from the play, or the coach's own words. */}
      <div
        className="grid shrink-0 gap-px border-t-2"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          background: c.rule,
          borderColor: c.rule,
        }}
      >
        {rows.map((row, i) => {
          const isNotes = i === rows.length - 1;
          return (
            <label
              key={row.key}
              className="flex min-w-0 items-baseline gap-[max(4px,0.8cqw)] px-[max(6px,1.2cqw)] py-[max(3px,0.7cqw)]"
              style={{ background: c.box, gridColumn: isNotes ? `span ${notesSpan}` : undefined }}
            >
              <span
                className="shrink-0 text-[max(9px,1.45cqw)] font-extrabold tracking-[0.06em]"
                style={{ color: c.muted }}
              >
                {row.label}
              </span>
              {onAssignmentChange && variant === "field" ? (
                <input
                  key={`${card.id}-${row.key}-${row.text}`}
                  defaultValue={row.text}
                  aria-label={`${row.label} assignment`}
                  className={cn(
                    "min-w-0 flex-1 bg-transparent text-[max(11px,1.75cqw)] font-semibold outline-none",
                    "rounded-sm focus-visible:ring-2 focus-visible:ring-[#2563eb]",
                    row.custom ? "italic" : "",
                  )}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  onBlur={(e) => {
                    const text = e.currentTarget.value.trim();
                    if (text !== row.text) onAssignmentChange(row.key, text);
                  }}
                />
              ) : (
                <span
                  className={cn(
                    "min-w-0 text-[max(11px,1.75cqw)] leading-tight font-semibold",
                    // Paper can't scroll or tap: wrap to two lines instead of cutting off.
                    variant === "print" ? "line-clamp-2 break-words" : "truncate",
                    row.custom ? "italic" : "",
                  )}
                >
                  {row.text || "—"}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </article>
  );
}

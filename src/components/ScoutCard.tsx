"use client";

import { useId, useRef, useState } from "react";
import type { HudlPlayCard } from "@/lib/hudlParser";
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

/** Card aspect ratio (width / height) shared with layouts that size cards. */
export const SCOUT_CARD_ASPECT = 760 / 600;

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
  className,
}: ScoutCardProps) {
  const c = PALETTES[variant];
  const diagram = buildDiagram(card, mode, unit);
  const rows = buildAssignments(card, diagram);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const movable = Boolean(onMoveDefender) && unit === "defense";
  const isDefense = unit === "defense";
  const cardNumber = String(card.playNumber).padStart(2, "0");
  const title = isDefense
    ? `${card.formation || "—"} vs ${card.defFront || "4-3"}`
    : `${card.formation || "—"} · ${card.playCall || "—"}`;
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

      <svg
        ref={svgRef}
        viewBox={`0 0 ${FIELD.width} ${FIELD.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="block min-h-0 w-full flex-1"
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
              markerWidth={4}
              markerHeight={4}
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 Z" fill={color} />
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
                <text key={`${x}-${y}`} x={x} y={y} dy="0.36em" letterSpacing={6}>
                  {label}
                </text>
              )),
            )}
        </g>

        {/* Line of scrimmage. */}
        <rect x={0} y={diagram.losY - 2.5} width={FIELD.width} height={5} fill={c.los} />

        {/* Blocks, pulls, fakes, routes, ball carrier. */}
        <g fill="none" stroke={c.block} strokeWidth={3} strokeLinecap="butt" strokeLinejoin="miter">
          {diagram.blocks.map((b, i) => (
            <path key={i} d={blockPath(b)} />
          ))}
          {diagram.targetBlocks.map(({ path }, i) => (
            <path key={`t${i}`} d={blockPath(path)} strokeWidth={3.5} />
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
              strokeWidth={3}
              strokeDasharray="7 6"
              markerEnd={marker("ball")}
            />
          ))}
          {diagram.routes.map((p, i) => (
            <path
              key={`r${i}`}
              d={linePath(p, 3)}
              stroke={c.route}
              strokeWidth={3.5}
              markerEnd={marker("route")}
            />
          ))}
          {diagram.carrier && (
            <path
              d={linePath(diagram.carrier, 3)}
              stroke={c.ball}
              strokeWidth={4}
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
                strokeWidth={3.5}
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
              x={p.x - 9}
              y={p.y - 9}
              width={18}
              height={18}
              fill={c.offenseFill}
              stroke={c.offense}
              strokeWidth={2.5}
            />
          ) : (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r={p.label ? 11 : 9}
                fill={c.offenseFill}
                stroke={c.offense}
                strokeWidth={2.5}
              />
              {p.label && (
                <text
                  x={p.x}
                  y={p.y}
                  dy="0.36em"
                  textAnchor="middle"
                  fontSize={13}
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

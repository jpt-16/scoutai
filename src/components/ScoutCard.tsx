import type { HudlPlayCard } from "@/lib/hudlParser";
import {
  buildDiagram,
  FIELD,
  PLAY_KIND_LABELS,
  type DiagramMode,
  type Point,
  type ScoutUnit,
} from "@/lib/formations";
import { cn } from "@/lib/utils";

export type ScoutCardVariant = "field" | "print";

interface ScoutCardProps {
  card: HudlPlayCard;
  /** `field` = dark, high-contrast iPad card. `print` = black ink on white. */
  variant?: ScoutCardVariant;
  /** `team` = all 11; `7v7` = skeleton, no linemen on either side. */
  mode?: DiagramMode;
  /** `offense` = scout offense (blocking, routes); `defense` = formation + defensive alignment. */
  unit?: ScoutUnit;
  className?: string;
}

const PALETTES = {
  field: {
    bg: "#0d1210",
    ink: "#f4f1e8",
    muted: "#a3ada7",
    field: "#10261c",
    grid: "#2f4a3d",
    los: "#f4f1e8",
    offense: "#f4f1e8",
    offenseFill: "#10261c",
    block: "#d9d4c7",
    route: "#5ab8ff",
    ball: "#ff8a3d",
    defense: "#ff8a3d",
    rule: "#2a3530",
    badgeBg: "#ff8a3d",
    badgeInk: "#0d1210",
  },
  print: {
    bg: "#ffffff",
    ink: "#111111",
    muted: "#4a4a4a",
    field: "#ffffff",
    grid: "#b5b5b5",
    los: "#111111",
    offense: "#111111",
    offenseFill: "#ffffff",
    block: "#111111",
    route: "#1d4ed8",
    ball: "#b3410e",
    defense: "#b3410e",
    rule: "#111111",
    badgeBg: "#111111",
    badgeInk: "#ffffff",
  },
} as const;

/** Card aspect ratio (width / height) shared with layouts that size cards. */
export const SCOUT_CARD_ASPECT = 760 / 556;

const YARD_LINES = [15, 65, 115, 165, 215, 265];
const HASH_TICKS = Array.from({ length: 30 }, (_, i) => 5 + i * 10);
const f = (n: number) => n.toFixed(1);

/** Unit vector of a segment and its angle. */
function heading(from: Point, to: Point) {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  return { a, cos: Math.cos(a), sin: Math.sin(a) };
}

/** Polyline starting at the player's circle edge and ending `endInset` short of the last point. */
function linePath(path: Point[], endInset: number): string {
  const [first, second] = path;
  const tip = path[path.length - 1];
  const s = heading(first, second);
  const e = heading(path[path.length - 2], tip);
  const start = { x: first.x + 12 * s.cos, y: first.y + 12 * s.sin };
  const end = { x: tip.x - endInset * e.cos, y: tip.y - endInset * e.sin };
  const middle = path
    .slice(1, -1)
    .map((p) => `L${f(p.x)} ${f(p.y)}`)
    .join("");
  return `M${f(start.x)} ${f(start.y)}${middle}L${f(end.x)} ${f(end.y)}`;
}

function arrowHead(path: Point[]): string {
  const tip = path[path.length - 1];
  const { cos, sin } = heading(path[path.length - 2], tip);
  const base = { x: tip.x - 14 * cos, y: tip.y - 14 * sin };
  const px = -sin * 7;
  const py = cos * 7;
  return `M${f(tip.x)} ${f(tip.y)}L${f(base.x + px)} ${f(base.y + py)}L${f(base.x - px)} ${f(base.y - py)}Z`;
}

/** Block symbol: the line, then a bar across its end. */
function blockPaths(path: Point[]): { line: string; bar: string } {
  const tip = path[path.length - 1];
  const { cos, sin } = heading(path[path.length - 2], tip);
  const px = -sin * 7;
  const py = cos * 7;
  return {
    line: linePath(path, 0),
    bar: `M${f(tip.x + px)} ${f(tip.y + py)}L${f(tip.x - px)} ${f(tip.y - py)}`,
  };
}

function HeaderStat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <span
        className="text-[max(10px,1.6cqw)] font-semibold tracking-[0.08em]"
        style={{ color: "var(--sc-muted)" }}
      >
        {label}
      </span>
      <span className="font-display truncate text-[max(17px,3.95cqw)] leading-[1.05] font-bold">
        {value}
      </span>
    </div>
  );
}

/**
 * A single scout card for the scout offense: header (card #, down & distance,
 * hash, formation, run/pass tag), an SVG of the offense with blocking or
 * routes, and the play call. Scales with its container via container-query units.
 */
export function ScoutCard({
  card,
  variant = "field",
  mode = "team",
  unit = "offense",
  className,
}: ScoutCardProps) {
  const c = PALETTES[variant];
  const diagram = buildDiagram(card, mode, unit);
  const isDefense = unit === "defense";
  const cardNumber = String(card.playNumber).padStart(2, "0");
  const note = [
    diagram.formationFallback
      ? card.formation
        ? "formation not recognized, drawn as Spread"
        : "no formation tagged, drawn as Spread"
      : null,
    diagram.frontFallback
      ? card.defFront
        ? "front drawn as 4-3"
        : "no front tagged, drawn as 4-3"
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      aria-label={`Card ${cardNumber}: ${card.downDistance}, ${card.formation || "unknown formation"}, ${card.playCall || "no play call"}`}
      className={cn(
        "@container flex aspect-[760/556] w-full flex-col overflow-hidden border-2",
        variant === "print" ? "rounded-md" : "rounded-[14px]",
        className,
      )}
      style={
        {
          background: c.bg,
          color: c.ink,
          borderColor: variant === "print" ? c.ink : c.rule,
          "--sc-muted": c.muted,
        } as React.CSSProperties
      }
    >
      <header
        className="flex h-[max(50px,10cqw)] shrink-0 items-stretch border-b-2"
        style={{ borderColor: c.rule }}
      >
        <div
          className="flex flex-col items-center justify-center px-[max(10px,2.4cqw)]"
          style={{ background: c.badgeBg, color: c.badgeInk }}
        >
          <span className="text-[max(10px,1.6cqw)] font-bold tracking-[0.12em]">CARD</span>
          <span className="font-display text-[max(24px,5.8cqw)] leading-[0.95] font-extrabold">
            {cardNumber}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-[max(12px,4cqw)] px-[max(10px,2.4cqw)]">
          <HeaderStat label="DOWN & DIST" value={card.downDistance} className="shrink-0" />
          <HeaderStat label="HASH" value={card.hash ?? "—"} className="shrink-0" />
          <HeaderStat label="FORMATION" value={card.formation.toUpperCase() || "—"} />
        </div>
        <div
          className="flex flex-col items-end justify-center border-l-2 px-[max(10px,2.4cqw)]"
          style={{ borderColor: c.rule }}
        >
          <span
            className="text-[max(10px,1.6cqw)] font-semibold tracking-[0.08em]"
            style={{ color: c.muted }}
          >
            {isDefense
              ? `DEF FRONT · ${mode === "7v7" ? "7v7" : "TEAM"}`
              : mode === "7v7"
                ? "7v7"
                : "TEAM"}
          </span>
          <span
            className="font-display max-w-[30cqw] truncate text-[max(17px,3.95cqw)] leading-[1.05] font-bold whitespace-nowrap"
            style={{ color: isDefense ? c.defense : diagram.kind === "run" ? c.ball : c.route }}
          >
            {isDefense ? card.defFront.toUpperCase() || "—" : PLAY_KIND_LABELS[diagram.kind]}
          </span>
        </div>
      </header>

      <svg
        viewBox={`0 0 ${FIELD.width} ${FIELD.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="block min-h-0 w-full flex-1"
        style={{ background: c.field }}
        role="img"
        aria-label="Offensive formation and assignments"
      >
        <g stroke={c.grid} fill="none">
          {YARD_LINES.map((y) => (
            <line key={y} x1={0} x2={FIELD.width} y1={y} y2={y} strokeWidth={1.5} />
          ))}
          {HASH_TICKS.map((y) => (
            <g key={y} strokeWidth={2}>
              <line x1={FIELD.hashX.L - 4} x2={FIELD.hashX.L + 4} y1={y} y2={y} />
              <line x1={FIELD.hashX.R - 4} x2={FIELD.hashX.R + 4} y1={y} y2={y} />
            </g>
          ))}
        </g>

        <line
          x1={0}
          x2={FIELD.width}
          y1={FIELD.los}
          y2={FIELD.los}
          stroke={c.los}
          strokeWidth={2}
          strokeDasharray="8 6"
        />
        {diagram.ballHashX != null && (
          <path
            d={`M${diagram.ballHashX - 8} 0L${diagram.ballHashX + 8} 0L${diagram.ballHashX} 12Z`}
            fill={c.los}
          />
        )}

        <g
          fill="none"
          stroke={c.block}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {diagram.blocks.map((b, i) => {
            const { line, bar } = blockPaths(b);
            return <path key={i} d={line + bar} />;
          })}
        </g>
        {diagram.pulls.map((p, i) => (
          <g key={i}>
            <path
              d={linePath(p, 12)}
              fill="none"
              stroke={c.block}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d={arrowHead(p)} fill={c.block} />
          </g>
        ))}
        {diagram.fakes.map((p, i) => (
          <g key={i}>
            <path
              d={linePath(p, 12)}
              fill="none"
              stroke={c.ball}
              strokeWidth={3}
              strokeDasharray="7 6"
              strokeLinecap="round"
            />
            <path d={arrowHead(p)} fill={c.ball} />
          </g>
        ))}
        {diagram.routes.map((p, i) => (
          <g key={i}>
            <path
              d={linePath(p, 12)}
              fill="none"
              stroke={c.route}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d={arrowHead(p)} fill={c.route} />
          </g>
        ))}
        {diagram.carrier && (
          <g>
            <path
              d={linePath(diagram.carrier, 12)}
              fill="none"
              stroke={c.ball}
              strokeWidth={4.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d={arrowHead(diagram.carrier)} fill={c.ball} />
          </g>
        )}

        {diagram.defense.map((p, i) => (
          <g key={`d${i}`}>
            <path
              d={`M${p.x - 7} ${p.y - 7}L${p.x + 7} ${p.y + 7}M${p.x + 7} ${p.y - 7}L${p.x - 7} ${p.y + 7}`}
              stroke={c.defense}
              strokeWidth={3.5}
              strokeLinecap="round"
            />
            <text
              x={p.x}
              y={p.y - 12}
              textAnchor="middle"
              fontSize={11}
              fontWeight={800}
              fontFamily="'Barlow Condensed', sans-serif"
              fill={c.defense}
            >
              {p.label}
            </text>
          </g>
        ))}

        {diagram.players.map((p, i) => {
          const center = p.role === "OL" && p.x === FIELD.center.x;
          return (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r={p.label ? 10.5 : 9}
                fill={center ? c.offense : c.offenseFill}
                stroke={c.offense}
                strokeWidth={3}
              />
              {p.label && (
                <text
                  x={p.x}
                  y={p.y}
                  dy="0.36em"
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={800}
                  fontFamily="'Barlow Condensed', sans-serif"
                  fill={c.offense}
                >
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <footer
        className="flex h-[max(26px,5cqw)] shrink-0 items-center justify-between gap-3 border-t-2 px-[max(10px,2.4cqw)] text-[max(11px,1.85cqw)]"
        style={{ borderColor: c.rule }}
      >
        <span className="min-w-0 truncate font-bold tracking-[0.04em]">
          {isDefense ? (
            <>
              COVERAGE:{" "}
              <span style={{ color: c.defense }}>{card.coverage.toUpperCase() || "—"}</span>
            </>
          ) : (
            <>
              PLAY:{" "}
              <span style={{ color: diagram.kind === "run" ? c.ball : c.route }}>
                {card.playCall.toUpperCase() || "—"}
              </span>
            </>
          )}
          {note && (
            <span className="ml-2 font-medium" style={{ color: c.muted }}>
              ({note})
            </span>
          )}
        </span>
        <span
          className="flex shrink-0 items-center gap-3 font-semibold"
          style={{ color: c.muted }}
          aria-hidden="true"
        >
          {isDefense ? (
            <>
              <span className="flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <circle cx="6" cy="6" r="4.5" fill="none" stroke={c.offense} strokeWidth={1.8} />
                </svg>
                OFF
              </span>
              <span className="flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <path d="M2 2L10 10M10 2L2 10" stroke={c.defense} strokeWidth={2} />
                </svg>
                DEF
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1">
                <svg width="16" height="12" viewBox="0 0 16 12">
                  <path
                    d="M1 10L12 3M9.5 0.5L14.5 7.5"
                    stroke={c.block}
                    strokeWidth={2}
                    fill="none"
                  />
                </svg>
                BLOCK
              </span>
              <span className="flex items-center gap-1">
                <svg width="16" height="12" viewBox="0 0 16 12">
                  <path d="M1 6H10" stroke={c.ball} strokeWidth={2.5} />
                  <path d="M15 6L9 2.5V9.5Z" fill={c.ball} />
                </svg>
                BALL
              </span>
              <span className="flex items-center gap-1">
                <svg width="16" height="12" viewBox="0 0 16 12">
                  <path d="M1 6H10" stroke={c.route} strokeWidth={2.5} />
                  <path d="M15 6L9 2.5V9.5Z" fill={c.route} />
                </svg>
                ROUTE
              </span>
            </>
          )}
        </span>
      </footer>
    </article>
  );
}

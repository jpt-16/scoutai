import type { HudlPlayCard } from "@/lib/hudlParser";
import { buildDiagram, FIELD, type Point } from "@/lib/formations";
import { cn } from "@/lib/utils";

export type ScoutCardVariant = "field" | "print";

interface ScoutCardProps {
  card: HudlPlayCard;
  /** `field` = dark, high-contrast iPad card. `print` = black ink on white. */
  variant?: ScoutCardVariant;
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
    defense: "#ff8a3d",
    route: "#5ab8ff",
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
    defense: "#b3410e",
    route: "#1d4ed8",
    rule: "#111111",
    badgeBg: "#111111",
    badgeInk: "#ffffff",
  },
} as const;

/** Card aspect ratio (width / height) shared with layouts that size cards. */
export const SCOUT_CARD_ASPECT = 760 / 556;

const YARD_LINES = [15, 65, 115, 165, 215, 265];
const HASH_TICKS = Array.from({ length: 30 }, (_, i) => 5 + i * 10);

function xPath({ x, y }: Point, r = 7): string {
  return `M${x - r} ${y - r}L${x + r} ${y + r}M${x + r} ${y - r}L${x - r} ${y + r}`;
}

/** Route polyline, pulled back from the player and the arrow tip, plus an arrowhead. */
function routePaths(route: Point[]): { line: string; head: string } {
  const [first, second] = route;
  const tip = route[route.length - 1];
  const beforeTip = route[route.length - 2];
  const a0 = Math.atan2(second.y - first.y, second.x - first.x);
  const a = Math.atan2(tip.y - beforeTip.y, tip.x - beforeTip.x);
  const f = (n: number) => n.toFixed(1);

  const start = { x: first.x + 12 * Math.cos(a0), y: first.y + 12 * Math.sin(a0) };
  const end = { x: tip.x - 12 * Math.cos(a), y: tip.y - 12 * Math.sin(a) };
  const middle = route.slice(1, -1).map((p) => `L${f(p.x)} ${f(p.y)}`).join("");
  const line = `M${f(start.x)} ${f(start.y)}${middle}L${f(end.x)} ${f(end.y)}`;

  const base = { x: tip.x - 14 * Math.cos(a), y: tip.y - 14 * Math.sin(a) };
  const px = -Math.sin(a) * 7;
  const py = Math.cos(a) * 7;
  const head = `M${f(tip.x)} ${f(tip.y)}L${f(base.x + px)} ${f(base.y + py)}L${f(base.x - px)} ${f(base.y - py)}Z`;
  return { line, head };
}

function HeaderStat({
  label,
  value,
  color,
  className,
}: {
  label: string;
  value: string;
  color?: string;
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
      <span
        className="font-display truncate text-[max(17px,3.95cqw)] leading-[1.05] font-bold"
        style={color ? { color } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * A single scout team card: header (card #, down & distance, hash, ball on,
 * formation, front), an SVG field diagram, and the play call.
 * Scales with its container width via container-query units.
 */
export function ScoutCard({ card, variant = "field", className }: ScoutCardProps) {
  const c = PALETTES[variant];
  const diagram = buildDiagram(card);
  const routes = diagram.routes.filter((r) => r.length >= 2).map(routePaths);
  const cardNumber = String(card.playNumber).padStart(2, "0");
  const note = [
    diagram.formationFallback
      ? card.formation
        ? "formation not recognized, drawn as Spread"
        : "no formation tagged, drawn as Spread"
      : null,
    diagram.frontFallback ? (card.defFront ? "front drawn as 4-3" : "no front tagged, drawn as 4-3") : null,
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
        <div className="flex min-w-0 flex-1 items-center gap-[max(10px,3.6cqw)] px-[max(10px,2.4cqw)]">
          <HeaderStat label="DOWN & DIST" value={card.downDistance} className="shrink-0" />
          <HeaderStat label="HASH" value={card.hash ?? "—"} className="shrink-0" />
          <HeaderStat label="BALL ON" value={card.yardLineLabel || "—"} className="shrink-0" />
          <HeaderStat label="FORMATION" value={card.formation.toUpperCase() || "—"} />
        </div>
        <div
          className="flex max-w-[28%] flex-col items-end justify-center border-l-2 px-[max(10px,2.4cqw)]"
          style={{ borderColor: c.rule }}
        >
          <HeaderStat
            label="DEF FRONT"
            value={card.defFront.toUpperCase() || "—"}
            color={c.defense}
            className="items-end"
          />
        </div>
      </header>

      <svg
        viewBox={`0 0 ${FIELD.width} ${FIELD.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="block min-h-0 w-full flex-1"
        style={{ background: c.field }}
        role="img"
        aria-label="Formation diagram"
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

        {routes.map((r, i) => (
          <g key={i}>
            <path
              d={r.line}
              fill="none"
              stroke={c.route}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d={r.head} fill={c.route} />
          </g>
        ))}

        <path
          d={diagram.defense.map((p) => xPath(p)).join("")}
          fill="none"
          stroke={c.defense}
          strokeWidth={3.5}
          strokeLinecap="round"
        />

        {diagram.offense.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={9}
            fill={c.offenseFill}
            stroke={c.offense}
            strokeWidth={3}
          />
        ))}
        <circle
          cx={diagram.center.x}
          cy={diagram.center.y}
          r={9}
          fill={c.offense}
          stroke={c.offense}
          strokeWidth={3}
        />
      </svg>

      <footer
        className="flex h-[max(26px,5cqw)] shrink-0 items-center justify-between gap-3 border-t-2 px-[max(10px,2.4cqw)] text-[max(11px,1.85cqw)]"
        style={{ borderColor: c.rule }}
      >
        <span className="min-w-0 truncate font-bold tracking-[0.04em]">
          PLAY: <span style={{ color: c.route }}>{card.playCall.toUpperCase() || "—"}</span>
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
        </span>
      </footer>
    </article>
  );
}

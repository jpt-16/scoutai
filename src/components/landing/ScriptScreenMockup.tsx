"use client";

import { ChevronLeft, ChevronRight, Grid2x2, Smartphone } from "lucide-react";
import { ScoutCard } from "@/components/ScoutCard";
import type { ScoutUnit } from "@/lib/formations";
import type { HudlPlayCard } from "@/lib/hudlParser";
import type { ScriptTendencies } from "@/lib/tendencies";
import { cn } from "@/lib/utils";

/**
 * A static, scaled-down rendition of the real /script reader (unit toggle,
 * period tabs, the card, Previous / Next) for the landing page's device
 * mockups. Every card is a real `ScoutCard` built from parsed demo data;
 * the chrome around it mirrors script/page.tsx. Decorative: exposed to
 * assistive tech as one labeled image, not five interactive cards.
 */
export function ScriptScreenMockup({
  cards,
  active = 0,
  unit = "offense",
  tendencies,
  fileName = "demo-script.csv",
  label,
}: {
  cards: HudlPlayCard[];
  active?: number;
  unit?: ScoutUnit;
  tendencies?: ScriptTendencies;
  fileName?: string;
  label: string;
}) {
  const pill = "rounded-[max(4px,0.8cqw)] px-[max(5px,1.1cqw)] py-[max(2px,0.45cqw)]";
  return (
    <div role="img" aria-label={label} className="@container pointer-events-none select-none">
      <div className="flex flex-col gap-[max(6px,1.4cqw)] p-[max(8px,1.8cqw)] text-[max(7px,1.35cqw)] font-bold">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-[max(6px,1.05cqw)] tracking-[0.14em] text-primary">SCOUT SCRIPT</span>
            <span className="truncate font-display text-[max(10px,2.3cqw)] font-extrabold">
              {fileName} · {cards.length} plays
            </span>
          </div>
          <div className="flex shrink-0 gap-[max(3px,0.6cqw)]">
            <div className="flex rounded-[max(5px,1cqw)] border bg-card p-[max(2px,0.35cqw)]">
              <span className={cn(pill, unit === "offense" ? "bg-foreground text-background" : "text-muted-foreground")}>
                SCOUT O
              </span>
              <span className={cn(pill, unit === "defense" ? "bg-foreground text-background" : "text-muted-foreground")}>
                SCOUT D
              </span>
            </div>
            <div className="hidden rounded-[max(5px,1cqw)] border bg-card p-[max(2px,0.35cqw)] @[380px]:flex">
              <span className={cn(pill, "flex items-center gap-1 bg-foreground text-background")}>
                <Smartphone className="size-[max(8px,1.4cqw)]" aria-hidden="true" />
                Field
              </span>
              <span className={cn(pill, "flex items-center gap-1 text-muted-foreground")}>
                <Grid2x2 className="size-[max(8px,1.4cqw)]" aria-hidden="true" />
                Print
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-[max(3px,0.6cqw)] text-muted-foreground">
          <span className={cn(pill, "bg-primary text-primary-foreground")}>ALL {cards.length}</span>
          <span className={cn(pill, "border")}>7v7</span>
          <span className={cn(pill, "border")}>TEAM</span>
          <span className="ml-auto tabular-nums">
            {active + 1} / {cards.length}
          </span>
        </div>

        <div className="grid">
          {cards.map((card, i) => (
            <div
              key={card.id}
              className="transition-opacity duration-700 [grid-area:1/1]"
              style={{ opacity: i === active ? 1 : 0 }}
            >
              <ScoutCard card={card} unit={unit} tendencies={tendencies} />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-[max(4px,0.9cqw)] font-display text-[max(9px,1.9cqw)] font-extrabold">
          <span className="flex items-center justify-center gap-1 rounded-[max(5px,1cqw)] border py-[max(4px,1cqw)] text-muted-foreground">
            <ChevronLeft className="size-[max(9px,1.8cqw)]" aria-hidden="true" />
            PREVIOUS CARD
          </span>
          <span className="flex items-center justify-center gap-1 rounded-[max(5px,1cqw)] bg-primary py-[max(4px,1cqw)] text-primary-foreground">
            NEXT CARD
            <ChevronRight className="size-[max(9px,1.8cqw)]" aria-hidden="true" />
          </span>
        </div>
      </div>
    </div>
  );
}

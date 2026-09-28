"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { ScoutCard } from "@/components/ScoutCard";
import { Button } from "@/components/ui/button";
import type { HudlPlayCard } from "@/lib/hudlParser";
import { cn } from "@/lib/utils";

type PerPage = 2 | 4;

const LAYOUTS: Record<PerPage, { orientation: string; sheet: string; grid: string }> = {
  // Letter landscape, 2 x 2.
  4: {
    orientation: "landscape",
    sheet: "w-[11in] h-[8.45in]",
    grid: "grid-cols-[4.5in_4.5in]",
  },
  // Letter portrait, stacked.
  2: {
    orientation: "portrait",
    sheet: "w-[8.5in] h-[10.95in]",
    grid: "grid-cols-[6.3in]",
  },
};

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

export function PrintGrid({ cards, fileName }: { cards: HudlPlayCard[]; fileName: string }) {
  const [perPage, setPerPage] = useState<PerPage>(4);
  const layout = LAYOUTS[perPage];
  const pages = chunk(cards, perPage);

  return (
    <div className="flex flex-1 flex-col">
      <style>{`@page { size: letter ${layout.orientation}; margin: 0; }`}</style>

      <div className="no-print flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <div role="group" aria-label="Cards per page" className="flex rounded-xl border bg-secondary p-1">
          {([2, 4] as const).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={perPage === n}
              onClick={() => setPerPage(n)}
              className={cn(
                "h-11 rounded-[9px] px-4 text-base font-bold transition-colors",
                perPage === n ? "bg-foreground text-background" : "text-foreground hover:bg-accent",
              )}
            >
              {n} per page
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {cards.length} cards · {pages.length} {pages.length === 1 ? "page" : "pages"} · Letter{" "}
          {layout.orientation}
        </p>
        <Button size="lg" className="ml-auto" onClick={() => window.print()} disabled={cards.length === 0}>
          <Printer aria-hidden="true" />
          Print / Save PDF
        </Button>
      </div>

      <div className="flex-1 overflow-auto bg-muted p-6 print:overflow-visible print:bg-white print:p-0">
        <div className="mx-auto flex w-fit flex-col gap-6 print:gap-0">
          {pages.map((page, i) => (
            <section
              key={i}
              aria-label={`Page ${i + 1}`}
              className={cn(
                layout.sheet,
                "flex flex-col gap-[0.2in] overflow-hidden bg-white p-[0.4in] text-[#111] shadow-lg",
                "print:shadow-none [break-after:page] last:[break-after:auto]",
              )}
            >
              <div className="flex items-end justify-between border-b-2 border-[#111] pb-1.5">
                <span className="font-display text-2xl font-extrabold tracking-[0.02em]">
                  SCOUT SCRIPT · {fileName}
                </span>
                <span className="text-sm font-semibold text-[#4a4a4a]">
                  {perPage} per page · Page {i + 1} of {pages.length} · ScoutCard AI
                </span>
              </div>
              <div className={cn("grid justify-center gap-[0.25in]", layout.grid)}>
                {page.map((card) => (
                  <ScoutCard key={card.id} card={card} variant="print" />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

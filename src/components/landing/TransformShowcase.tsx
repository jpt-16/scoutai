import { ArrowRight, Sparkles } from "lucide-react";
import { HudlCsvMockup } from "@/components/HudlCsvMockup";
import { ScoutCard } from "@/components/ScoutCard";
import type { HudlPlayCard } from "@/lib/hudlParser";

/**
 * Hudl → ScoutCard centerpiece. `card` must be the parsed card for the
 * mockup's highlighted row (demo row 2, Trips Right · Quick Slant), so the
 * "this row became this card" claim is literally true. The mapping chips
 * describe what the parser really does with each column (see CLAUDE.md).
 */
const MAPPINGS: [string, string][] = [
  ["OFF FORM", "Formation drawn"],
  ["OFF PLAY", "Routes & blocking"],
  ["HASH", "Ball on its hash"],
  ["DN · DIST", "Card header"],
];

export function TransformShowcase({ card }: { card: HudlPlayCard }) {
  return (
    <div className="relative overflow-hidden rounded-[28px] border bg-gradient-to-b from-card to-background p-5 sm:p-8 lg:p-10">
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[70%] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
        aria-hidden="true"
      />
      <div className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,1.05fr)_auto_minmax(0,1fr)] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-xs font-bold tracking-[0.16em] text-muted-foreground">YOUR HUDL BREAKDOWN</p>
          <HudlCsvMockup highlightRow={1} compact />
        </div>

        {/* Connector: a pulse travels from the row to the card. */}
        <div className="flex flex-col items-center justify-center lg:flex-row" aria-hidden="true">
          <div className="relative hidden h-px w-16 bg-border lg:block">
            <span className="sc-flow absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_12px] shadow-primary" />
          </div>
          <div className="relative h-10 w-px bg-border lg:hidden">
            <span className="sc-flow-y absolute left-1/2 size-2 -translate-x-1/2 rounded-full bg-primary shadow-[0_0_12px] shadow-primary" />
          </div>
          <span className="relative my-2 flex size-14 items-center justify-center rounded-full border-2 border-primary bg-background text-primary lg:mx-3 lg:my-0">
            <span className="sc-ping absolute inset-0 rounded-full border-2 border-primary" />
            <Sparkles className="size-6" />
          </span>
          <div className="relative hidden h-px w-16 bg-border lg:block">
            <span className="sc-flow absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_12px] shadow-primary [animation-delay:1.1s]" />
          </div>
          <div className="relative h-10 w-px bg-border lg:hidden">
            <span className="sc-flow-y absolute left-1/2 size-2 -translate-x-1/2 rounded-full bg-primary shadow-[0_0_12px] shadow-primary [animation-delay:1.1s]" />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-xs font-bold tracking-[0.16em] text-muted-foreground">PLAY 2, AS A SCOUT CARD</p>
          <div className="rounded-[18px] shadow-2xl shadow-black/50 ring-1 ring-primary/30">
            <ScoutCard card={card} />
          </div>
        </div>
      </div>

      <ul className="relative mt-8 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {MAPPINGS.map(([from, to]) => (
          <li
            key={from}
            className="flex flex-col gap-1 rounded-xl border bg-background/60 px-3.5 py-3 sm:flex-row sm:items-center sm:gap-2"
          >
            <span className="font-mono text-xs font-bold text-primary">{from}</span>
            <ArrowRight className="hidden size-3.5 text-muted-foreground sm:block" aria-hidden="true" />
            <span className="text-sm font-semibold">{to}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FORMATION_LABELS, inPeriod } from "@/lib/formations";
import type { HudlPlayCard } from "@/lib/hudlParser";
import { playbookCallLine, type PeriodKind } from "@/lib/practicePlan";
import { cn } from "@/lib/utils";

/**
 * Picks plays from the staff's saved playbook for an offense period of the
 * practice playsheet. Each pick becomes a line of the playsheet, which the
 * playsheet then matches to what the opponent's defense showed (Scout D).
 */
export function PlaybookPicker({
  open,
  onOpenChange,
  cards,
  kind,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cards: HudlPlayCard[];
  kind: PeriodKind;
  onAdd: (picked: HudlPlayCard[]) => void;
}) {
  // 7v7 has no run game, so it starts on the passes; Team shows the whole book.
  const [everything, setEverything] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const shown = useMemo(
    () => (kind === "7v7" && !everything ? cards.filter((c) => inPeriod(c, kind, "offense")) : cards),
    [cards, kind, everything],
  );
  const chosen = shown.filter((c) => picked.has(c.id));
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-bold">Add from your playbook</DialogTitle>
          <DialogDescription className="text-base">
            Pick the plays this period runs. Each becomes a line of the playsheet, and a Scout D look from
            the opponent&apos;s film is matched to it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="lg"
            onClick={() => setPicked(new Set(shown.map((c) => c.id)))}
            disabled={shown.length === 0}
          >
            Select all {shown.length}
          </Button>
          <Button variant="ghost" size="lg" onClick={() => setPicked(new Set())} disabled={picked.size === 0}>
            Clear
          </Button>
          {kind === "7v7" && (
            <label className="ml-auto flex h-11 items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={everything}
                onChange={(e) => setEverything(e.target.checked)}
                className="size-5 accent-[var(--primary)]"
              />
              Show runs too
            </label>
          )}
        </div>

        {shown.length === 0 ? (
          <p className="rounded-xl bg-muted/50 px-4 py-3 text-base text-muted-foreground">
            No plays in your playbook for this period yet.
          </p>
        ) : (
          <ul className="flex max-h-[48dvh] flex-col divide-y overflow-y-auto rounded-xl border bg-card">
            {shown.map((c) => {
              const on = picked.has(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(c.id)}
                    className={cn(
                      "flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                      "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                      on ? "bg-primary/15" : "hover:bg-accent",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-md border-2 text-sm font-extrabold",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                    >
                      {on ? "✓" : ""}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-base font-bold uppercase">{playbookCallLine(c)}</span>
                      <span className="truncate text-xs font-semibold text-muted-foreground">
                        {FORMATION_LABELS[c.formationKey === "unknown" ? "spread" : c.formationKey]}
                        {c.formationKey === "unknown" && " (not recognized)"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter>
          <Button
            size="lg"
            disabled={chosen.length === 0}
            onClick={() => {
              onAdd(chosen);
              setPicked(new Set());
              onOpenChange(false);
            }}
          >
            Add {chosen.length || ""} {chosen.length === 1 ? "play" : "plays"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

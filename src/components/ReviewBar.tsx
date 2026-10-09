"use client";

import { useMemo } from "react";
import { Check, Download, Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { snapshotTags, type HudlPlayCard } from "@/lib/hudlParser";
import {
  TAG_FIELDS,
  changedFields,
  correctedCsv,
  reviewStatus,
  summarize,
  taggedCsv,
  type TagField,
} from "@/lib/review";
import { cn } from "@/lib/utils";

/** What the file said for one tag, as it reads on the card. */
const SHOWN: Record<TagField, (t: ReturnType<typeof snapshotTags>) => string> = {
  formation: (t) => t.formation,
  strength: (t) => t.offStrength,
  playCall: (t) => t.playCall,
  direction: (t) => t.playDir,
  hash: (t) => t.hash ?? "",
  front: (t) => t.defFront,
  coverage: (t) => t.coverage,
};

/**
 * Review strip on the script reader: for the play on screen, the tags the file came with,
 * and one tap to say they're right or to open Edit play. Checked plays are kept with what
 * the file said, so the app can score the tags and export the two sheets (src/lib/review.ts).
 */
export function ReviewBar({
  card,
  cards,
  position,
  shown,
  onlyUnchecked,
  onOnlyUnchecked,
  onRight,
  onUndo,
  onFix,
  onSummary,
}: {
  card: HudlPlayCard;
  /** Every play in the script, for the progress count. */
  cards: HudlPlayCard[];
  position: number;
  shown: number;
  onlyUnchecked: boolean;
  onOnlyUnchecked: (on: boolean) => void;
  onRight: () => void;
  onUndo: () => void;
  onFix: () => void;
  onSummary: () => void;
}) {
  const summary = useMemo(() => summarize(cards), [cards]);
  const status = reviewStatus(card);
  const changed = changedFields(card);
  const was = card.tagged;
  const now = snapshotTags(card);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-2 sm:px-6">
      <div className="flex min-w-36 flex-col leading-tight">
        <span className="text-xs font-bold tracking-[0.12em] text-muted-foreground">REVIEW</span>
        <span className="text-sm font-bold tabular-nums">
          {summary.checked} of {summary.total} checked
          {summary.fixed > 0 && <span className="text-amber-400"> · {summary.fixed} fixed</span>}
        </span>
        <span className="mt-1 h-1.5 w-36 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${summary.total ? (summary.checked / summary.total) * 100 : 0}%` }}
          />
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" aria-label="Tags from the file">
        {was &&
          TAG_FIELDS.map(({ field, label }) => {
            const before = SHOWN[field](was);
            const after = SHOWN[field](now);
            const isChanged = changed.includes(field);
            if (!before && !after) return null;
            return (
              <span
                key={field}
                className={cn(
                  "flex h-9 items-baseline gap-1.5 rounded-lg border px-2.5 text-sm",
                  isChanged ? "border-amber-500/60 bg-amber-500/10" : "border-border",
                )}
              >
                <span className="text-[10px] font-bold tracking-[0.1em] text-muted-foreground">{label.toUpperCase()}</span>
                {isChanged ? (
                  <span className="self-center font-semibold">
                    <span className="text-muted-foreground line-through">{before || "—"}</span>
                    {" → "}
                    {after || "—"}
                  </span>
                ) : (
                  <span className="self-center font-semibold">{before}</span>
                )}
              </span>
            );
          })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {status === "unchecked" ? (
          <>
            <Button size="lg" onClick={onRight}>
              <Check aria-hidden="true" />
              Looks right
            </Button>
            <Button size="lg" variant="outline" onClick={onFix}>
              <Pencil aria-hidden="true" />
              Fix
            </Button>
          </>
        ) : (
          <>
            <span
              className={cn(
                "flex h-11 items-center gap-1.5 rounded-[10px] border px-3 text-sm font-bold",
                status === "fixed" ? "border-amber-500/60 text-amber-400" : "border-primary/60 text-primary",
              )}
            >
              <Check className="size-4" aria-hidden="true" />
              {status === "fixed" ? "Checked · fixed" : "Checked · right"}
            </span>
            <Button size="lg" variant="outline" onClick={onFix}>
              <Pencil aria-hidden="true" />
              Edit
            </Button>
            <Button size="lg" variant="ghost" onClick={onUndo}>
              <RotateCcw aria-hidden="true" />
              Undo
            </Button>
          </>
        )}
        <Button
          size="lg"
          variant={onlyUnchecked ? "default" : "outline"}
          aria-pressed={onlyUnchecked}
          onClick={() => onOnlyUnchecked(!onlyUnchecked)}
        >
          Unchecked only
        </Button>
        <Button size="lg" variant="outline" onClick={onSummary}>
          Scorecard
        </Button>
      </div>
      <span className="sr-only">
        Play {position + 1} of {shown}
      </span>
    </div>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** How the file's tags held up against the coach's checks, and the two sheets to take away. */
export function ReviewSummaryDialog({
  open,
  onOpenChange,
  cards,
  film,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cards: HudlPlayCard[];
  film: string;
}) {
  const s = useMemo(() => summarize(cards), [cards]);
  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");
  const base = film.replace(/\.(csv|xlsx)$/i, "").replace(/[^\w-]+/g, "-") || "script";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-bold">Scorecard</DialogTitle>
          <DialogDescription className="text-base">
            How the tags in the file held up against the plays you checked.
          </DialogDescription>
        </DialogHeader>

        {s.checked === 0 ? (
          <p className="rounded-xl bg-muted/50 px-4 py-3 text-base text-muted-foreground">
            Nothing checked yet. Tap <span className="font-semibold text-foreground">Looks right</span> or{" "}
            <span className="font-semibold text-foreground">Fix</span> on a play and it counts here.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { label: "CHECKED", value: `${s.checked}/${s.total}` },
                { label: "RIGHT AS TAGGED", value: pct(s.right, s.checked) },
                { label: "FIXED", value: String(s.fixed) },
              ].map((x) => (
                <div key={x.label} className="rounded-xl border bg-card px-2 py-3">
                  <div className="font-display text-3xl font-extrabold tabular-nums">{x.value}</div>
                  <div className="text-[11px] font-bold tracking-[0.1em] text-muted-foreground">{x.label}</div>
                </div>
              ))}
            </div>

            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] font-bold tracking-[0.1em] text-muted-foreground">
                  <th className="py-1.5">TAG</th>
                  <th className="py-1.5 text-right">WRONG</th>
                  <th className="py-1.5 text-right">RIGHT</th>
                </tr>
              </thead>
              <tbody>
                {TAG_FIELDS.map(({ field, label }) => (
                  <tr key={field} className="border-t">
                    <td className="py-1.5 font-semibold">{label}</td>
                    <td className={cn("py-1.5 text-right tabular-nums", s.wrong[field] > 0 && "font-bold text-amber-400")}>
                      {s.wrong[field]}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{pct(s.checked - s.wrong[field], s.checked)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {s.formationFixes.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-bold tracking-[0.1em] text-muted-foreground">FORMATION FIXES</span>
                {s.formationFixes.map((f) => (
                  <span key={`${f.from}${f.to}`} className="text-sm">
                    <span className="font-semibold">{f.from}</span> → <span className="font-semibold">{f.to}</span>
                    <span className="text-muted-foreground"> ×{f.count}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-2 border-t pt-4">
              <span className="text-sm text-muted-foreground">
                The two sheets for the plays you checked, in Hudl&apos;s column names, for comparing a
                computer-vision read against your corrections.
              </span>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="lg" onClick={() => download(`${base}-hudl.csv`, taggedCsv(cards))}>
                  <Download aria-hidden="true" />
                  As tagged (hudl.csv)
                </Button>
                <Button size="lg" onClick={() => download(`${base}-corrected.csv`, correctedCsv(cards))}>
                  <Download aria-hidden="true" />
                  Corrected (corrected.csv)
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useRef, useState } from "react";
import { Download, LoaderCircle, Sun } from "lucide-react";
import { ScoutCard, SCOUT_CARD_ASPECT } from "@/components/ScoutCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EXPORT_TARGETS,
  exportFileName,
  fitCard,
  imageName,
  type ExportTarget,
} from "@/lib/exportUtils";
import type { DiagramMode, ScoutUnit } from "@/lib/formations";
import type { HudlPlayCard } from "@/lib/hudlParser";
import { cn } from "@/lib/utils";

type Format = "pdf" | "images";

const chip = (selected: boolean) =>
  cn(
    "flex min-h-11 flex-col items-start justify-center rounded-[10px] border px-3 py-1.5 text-left leading-tight transition-colors",
    "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
    selected ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent",
  );

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * One-click script export for sideline screens (The CoachPad, an iPad) or
 * paper: every card in the current view, one per page, as a single PDF or a
 * ZIP of numbered PNGs (src/lib/exportUtils.ts). Runs in the browser: each
 * card is drawn at the screen's own pixel size, captured with html-to-image,
 * and packed with jsPDF or JSZip, all loaded only when a coach exports.
 */
export function ExportModal({
  open,
  onOpenChange,
  cards,
  fileName,
  mode,
  unit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cards: HudlPlayCard[];
  fileName: string;
  mode: DiagramMode;
  unit: ScoutUnit;
}) {
  const [targetId, setTargetId] = useState<ExportTarget["id"]>("coachpad");
  const [format, setFormat] = useState<Format>("pdf");
  const [sunlight, setSunlight] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frames = useRef<(HTMLDivElement | null)[]>([]);
  const target = EXPORT_TARGETS.find((t) => t.id === targetId)!;
  const box = fitCard(target.px, SCOUT_CARD_ASPECT);
  const busy = progress !== null;

  const run = async () => {
    setError(null);
    setProgress({ done: 0, total: cards.length });
    try {
      // Let the hidden frames mount, then capture them one by one.
      await nextFrame();
      await nextFrame();
      await document.fonts?.ready;
      const { toPng, getFontEmbedCSS } = await import("html-to-image");
      const first = frames.current[0];
      if (!first) throw new Error("Nothing to export");
      const fontEmbedCSS = await getFontEmbedCSS(first);
      const images: string[] = [];
      for (let i = 0; i < cards.length; i++) {
        const node = frames.current[i];
        if (!node) continue;
        images.push(
          await toPng(node, {
            width: target.px.w,
            height: target.px.h,
            pixelRatio: 1,
            backgroundColor: "#ffffff",
            fontEmbedCSS,
            cacheBust: false,
          }),
        );
        setProgress({ done: i + 1, total: cards.length });
      }

      if (format === "pdf") {
        const { jsPDF } = await import("jspdf");
        const { w, h } = target.pageIn;
        const doc = new jsPDF({ orientation: "landscape", unit: "in", format: [w, h], compress: true });
        images.forEach((png, i) => {
          if (i > 0) doc.addPage([w, h], "landscape");
          doc.addImage(png, "PNG", 0, 0, w, h, undefined, "FAST");
        });
        download(doc.output("blob"), exportFileName(fileName, unit, mode, target.id, "pdf"));
      } else {
        const { default: JSZip } = await import("jszip");
        const zip = new JSZip();
        images.forEach((png, i) =>
          zip.file(imageName(i, images.length, cards[i].playNumber, cards[i].formation), png.split(",")[1], {
            base64: true,
          }),
        );
        download(
          await zip.generateAsync({ type: "blob" }),
          exportFileName(fileName, unit, mode, target.id, "zip"),
        );
      }
      onOpenChange(false);
    } catch (e) {
      console.error("export failed", e);
      setError("Couldn't build the export. Try again, or use Print / Save PDF.");
    } finally {
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-bold">Export for a sideline screen</DialogTitle>
          <DialogDescription className="text-base">
            All {cards.length} {cards.length === 1 ? "card" : "cards"} in this view, one per page, ready to load on
            The CoachPad or an iPad by cloud sync or USB.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div role="group" aria-label="Screen" className="flex flex-col gap-1.5">
            <span className="text-xs font-bold tracking-[0.12em] text-muted-foreground">SCREEN</span>
            <div className="flex flex-wrap gap-1.5">
              {EXPORT_TARGETS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={targetId === t.id}
                  className={chip(targetId === t.id)}
                  onClick={() => setTargetId(t.id)}
                  disabled={busy}
                >
                  <span className="text-sm font-bold">{t.label}</span>
                  <span className={cn("text-[11px] font-semibold", targetId === t.id ? "text-primary-foreground/75" : "text-muted-foreground")}>
                    {t.px.w} × {t.px.h}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div role="group" aria-label="Format" className="flex flex-col gap-1.5">
            <span className="text-xs font-bold tracking-[0.12em] text-muted-foreground">FORMAT</span>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { value: "pdf", label: "One PDF", detail: "a page per card" },
                  { value: "images", label: "Image set", detail: "ZIP of numbered PNGs" },
                ] as const
              ).map((f) => (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={format === f.value}
                  className={chip(format === f.value)}
                  onClick={() => setFormat(f.value)}
                  disabled={busy}
                >
                  <span className="text-sm font-bold">{f.label}</span>
                  <span className={cn("text-[11px] font-semibold", format === f.value ? "text-primary-foreground/75" : "text-muted-foreground")}>
                    {f.detail}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            aria-pressed={sunlight}
            onClick={() => setSunlight((s) => !s)}
            disabled={busy}
            className={cn(chip(sunlight), "flex-row items-center gap-2.5 self-start")}
          >
            <Sun className="size-5" aria-hidden="true" />
            <span className="flex flex-col">
              <span className="text-sm font-bold">Sunlight mode</span>
              <span className={cn("text-[11px] font-semibold", sunlight ? "text-primary-foreground/75" : "text-muted-foreground")}>
                {sunlight ? "Black and white, thick lines" : "Off: red routes, blue line of scrimmage"}
              </span>
            </span>
          </button>

          {error && (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="items-center gap-3">
          {progress && (
            <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
              Drawing card {progress.done} of {progress.total}…
            </span>
          )}
          <Button size="lg" onClick={() => void run()} disabled={busy || cards.length === 0}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
            {busy ? "Exporting…" : format === "pdf" ? "Download PDF" : "Download images"}
          </Button>
        </DialogFooter>

        {/* The pages themselves, drawn off screen at the target's own pixel size while exporting. */}
        {busy && (
          <div aria-hidden="true" style={{ position: "fixed", left: -100_000, top: 0, pointerEvents: "none" }}>
            {cards.map((card, i) => (
              <div
                key={card.id}
                ref={(el) => {
                  frames.current[i] = el;
                }}
                style={{ position: "relative", width: target.px.w, height: target.px.h, background: "#ffffff" }}
              >
                <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h }}>
                  <ScoutCard
                    card={card}
                    variant="print"
                    mode={mode}
                    unit={unit}
                    contrast={sunlight ? "high" : "normal"}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

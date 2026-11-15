"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Lock, Smartphone, X } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { ScoutCard } from "@/components/ScoutCard";
import { UploadDropzone } from "@/components/UploadDropzone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MOCK_HUDL_CSV, DEMO_FILE_NAME } from "@/lib/demoScript";
import { parseHudlCsvText, type HudlField, type HudlParseResult, type UnsupportedFileKind } from "@/lib/hudlParser";
import { importFilms } from "@/lib/importFilms";
import { saveScript, storeScript } from "@/lib/scriptStore";

const PREVIEW_CARD = parseHudlCsvText(
  "PLAY #,DN,DIST,HASH,YARD LN,OFF FORM,OFF PLAY,DEF FRONT\n7,3,6,L,-35,TRIPS RT,4 VERTS,4-3\n",
).cards[0];

const FIELD_LABELS: Record<HudlField, string> = {
  playNumber: "Play #",
  down: "Down",
  distance: "Distance",
  yardLine: "Yard line",
  hash: "Hash",
  formation: "Formation",
  playCall: "Play call",
  playType: "Play type",
  defFront: "Def front",
  result: "Result",
  coverage: "Coverage",
  offStrength: "Off strength",
  playDir: "Play direction",
  odk: "ODK",
};

const UNSUPPORTED_LABELS: Record<UnsupportedFileKind, string> = {
  numbers: "Apple Numbers file",
  excel: "Excel workbook",
  binary: "not a text file",
};

const REPORT_FIELDS: HudlField[] = [
  "playNumber",
  "down",
  "distance",
  "hash",
  "yardLine",
  "formation",
  "playCall",
  "defFront",
];

const STEPS = [
  "Export the breakdown from Hudl as CSV",
  "Drop it here and check the cards",
  "Run the script on the iPad or print it",
];

export default function UploadPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ fileName: string; result: HudlParseResult } | null>(null);

  const handleFiles = async (files: File[]) => {
    setBusy(true);
    setError(null);
    try {
      const imported = await importFilms(files);
      if (imported.cards.length > 0) {
        // At least one usable play: go straight to the cards. Notes about the
        // files (including any film that failed) show there, not in a blocking dialog.
        storeScript({
          fileName: "",
          films: imported.films,
          savedAt: "",
          cards: imported.cards,
          warnings: imported.warnings,
        });
        router.push("/script?loaded=1");
        return;
      }
      const [first] = imported.failed;
      setReport({
        fileName: files.length > 1 ? `${first.name} (and ${files.length - 1} more)` : first.name,
        result: first.result,
      });
    } catch {
      setError("Couldn't read those files. Try exporting them from Hudl again.");
    } finally {
      setBusy(false);
    }
  };

  const handleDemo = () => {
    saveScript(DEMO_FILE_NAME, parseHudlCsvText(MOCK_HUDL_CSV));
    router.push("/script");
  };


  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-background/70 px-6 backdrop-blur-xl backdrop-saturate-150 lg:px-12 contrast-more:bg-background motion-reduce:backdrop-blur-none">
        <BrandMark />
        <p className="hidden items-center gap-2 text-[15px] text-muted-foreground md:flex">
          <Smartphone className="size-[18px]" aria-hidden="true" />
          Add to Home Screen to use offline on the field
        </p>
      </header>

      <main className="flex flex-1 flex-col items-center px-6 pb-24">
        <section className="flex w-full max-w-[880px] flex-col items-center gap-6 pt-14 text-center sm:pt-20">
          <p className="text-[15px] font-semibold tracking-[0.01em] text-primary">
            Scout team cards from your Hudl breakdown
          </p>
          <h1 className="text-balance text-[44px] leading-[1.03] font-bold tracking-[-0.03em] sm:text-[72px] sm:leading-[1.02]">
            Stop drawing cards.
            <br />
            <span className="text-muted-foreground">Start repping looks.</span>
          </h1>
          <p className="max-w-[600px] text-pretty text-[19px] leading-[1.45] text-muted-foreground sm:text-[21px]">
            Drop in this week&apos;s breakdown. Every play becomes a clean card to flip through on the
            iPad at practice, or print 2 or 4 to a page.
          </p>
          <div className="mt-4 w-full">
            <UploadDropzone onFiles={handleFiles} onDemo={handleDemo} busy={busy} error={error} />
          </div>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="size-4" aria-hidden="true" />
            Parsed on this device. Your film breakdown never leaves the iPad.
          </p>
        </section>

        <section
          aria-label="Example scout card"
          className="relative mt-20 w-full max-w-[760px] sm:mt-28"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-x-8 -inset-y-10 -z-10 rounded-[48px] bg-[radial-gradient(60%_60%_at_50%_50%,rgba(255,138,61,0.16),transparent_70%)]"
          />
          <div className="overflow-hidden rounded-3xl shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] ring-1 ring-white/10">
            <ScoutCard card={PREVIEW_CARD} />
          </div>
          <p className="mt-5 text-center text-[15px] text-muted-foreground">
            Every card is drawn from a single row of your Hudl export.
          </p>
        </section>

        <section aria-label="How it works" className="mt-24 w-full max-w-[980px] sm:mt-32">
          <h2 className="text-center text-[32px] leading-tight font-bold tracking-[-0.02em] sm:text-[44px]">
            Three steps. No drawing.
          </h2>
          <ol className="mt-10 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li
                key={step}
                className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/[0.04] p-6"
              >
                <span className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-[17px] font-semibold text-primary">
                  {i + 1}
                </span>
                <span className="text-[19px] leading-snug font-semibold tracking-[-0.01em]">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <Dialog open={report != null} onOpenChange={(open) => !open && setReport(null)}>
        <DialogContent className="sm:max-w-xl">
          {report && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-3xl font-bold">
                  {report.result.unsupportedFile ? "Save this as a CSV first" : "No plays found"}
                </DialogTitle>
                <DialogDescription className="text-base">
                  {report.result.unsupportedFile
                    ? `${report.fileName} · ${UNSUPPORTED_LABELS[report.result.unsupportedFile.kind]}`
                    : `${report.fileName} · ${report.result.rowCount} rows read`}
                </DialogDescription>
              </DialogHeader>

              {report.result.unsupportedFile ? (
                <p className="rounded-lg border bg-card p-4 text-base leading-relaxed">
                  {report.result.unsupportedFile.message}
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-bold tracking-[0.12em] text-muted-foreground">
                      COLUMNS MATCHED
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {REPORT_FIELDS.map((field) => {
                        const column = report.result.columns[field];
                        return (
                          <Badge
                            key={field}
                            variant={column ? "secondary" : "outline"}
                            className="h-8 gap-1.5 px-2.5 text-sm"
                          >
                            {column ? (
                              <Check className="text-primary" aria-hidden="true" />
                            ) : (
                              <X className="text-muted-foreground" aria-hidden="true" />
                            )}
                            {FIELD_LABELS[field]}
                            {column && <span className="text-muted-foreground">← {column}</span>}
                            {!column && <span className="sr-only">(not found)</span>}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>

                  {report.result.warnings.length > 0 && (
                    <ul className="flex flex-col gap-1.5 rounded-lg border bg-card p-3 text-sm">
                      {report.result.warnings.map((w) => (
                        <li key={w} className="flex gap-2">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                          {w}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              <DialogFooter>
                <Button size="lg" onClick={() => setReport(null)}>
                  Try another file
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

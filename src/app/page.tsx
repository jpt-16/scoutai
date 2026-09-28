"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Film, Layers, Lock, Printer, Smartphone, Upload, X } from "lucide-react";
import { AccountMenu } from "@/components/AccountMenu";
import { BrandMark } from "@/components/BrandMark";
import { ScoutCard } from "@/components/ScoutCard";
import { UploadDropzone } from "@/components/UploadDropzone";
import { VideoUploadCard } from "@/components/VideoUploadCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

const HOW_IT_WORKS_STEPS: { icon: typeof Upload; title: string; detail: string }[] = [
  {
    icon: Upload,
    title: "Upload your breakdown",
    detail:
      "Drop this week's Hudl CSV — or a few film clips at once — and it's parsed right in your " +
      "browser. Nothing is uploaded for the free path.",
  },
  {
    icon: Layers,
    title: "Cards build automatically",
    detail:
      "Formation, routes, blocking, and assignments turn into a clean vector scout card for " +
      "every play, matched straight from your Hudl tags.",
  },
  {
    icon: Smartphone,
    title: "Run it at practice",
    detail:
      "Swipe through cards on the iPad, filter by down or formation, and add it to your Home " +
      "Screen to keep using it offline on the field.",
  },
  {
    icon: Printer,
    title: "Or print the script",
    detail:
      "Switch to Print Grid for 2 or 4 cards a page and hit Print / Save PDF — black on white, " +
      "ready for a binder.",
  },
  {
    icon: Film,
    title: "No CSV? Use game film",
    detail:
      "Upload a clip and AI analyzes the play — routes appear on a card automatically, ready " +
      "for your staff to drag into shape. A paid feature, per coaching staff.",
  },
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
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b px-6 lg:px-12">
        <BrandMark />
        <div className="flex items-center gap-5">
          <p className="hidden items-center gap-2 text-[15px] font-medium text-muted-foreground md:flex">
            <Smartphone className="size-[18px]" aria-hidden="true" />
            Add to Home Screen to use offline on the field
          </p>
          <AccountMenu />
        </div>
      </header>

      <main className="grid flex-1 gap-10 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_520px] lg:gap-14 lg:px-12 lg:py-12">
        <section className="flex min-w-0 flex-col gap-6">
          <p className="text-sm font-bold tracking-[0.14em] text-primary">
            SCOUT TEAM CARDS FROM YOUR HUDL BREAKDOWN
          </p>
          <h1 className="font-display text-5xl leading-[0.95] font-extrabold uppercase sm:text-[68px]">
            Stop drawing cards.
            <br />
            Start repping looks.
          </h1>
          <p className="max-w-[540px] text-[19px] leading-normal text-[#c9cfc9]">
            Upload this week&apos;s Hudl breakdown. Every play becomes a clean vector card you can flip
            through on the iPad at practice, or print 2 or 4 to a page.
          </p>
          <div className="mt-2">
            <UploadDropzone onFiles={handleFiles} onDemo={handleDemo} busy={busy} error={error} />
          </div>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="size-4" aria-hidden="true" />
            Parsed on this device. Your film breakdown never leaves the iPad.
          </p>

          <VideoUploadCard />
        </section>

        <aside className="flex flex-col gap-5">
          <ScoutCard card={PREVIEW_CARD} />
          <ol className="grid grid-cols-3 gap-3">
            {STEPS.map((step, i) => (
              <li key={step}>
                <Card className="h-full gap-1.5 rounded-xl py-3.5">
                  <CardContent className="flex flex-col gap-1.5 px-3.5">
                    <span className="font-display text-[22px] font-extrabold text-primary">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-[15px] leading-snug font-semibold">{step}</span>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </aside>
      </main>

      <section className="border-t px-6 py-10 lg:px-12 lg:py-12">
        <p className="text-sm font-bold tracking-[0.14em] text-primary">HOW SCOUTCARD AI WORKS</p>
        <h2 className="mt-2 font-display text-3xl leading-tight font-extrabold uppercase sm:text-4xl">
          From breakdown to practice
        </h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {HOW_IT_WORKS_STEPS.map(({ icon: Icon, title, detail }, i) => (
            <li key={title}>
              <Card className="h-full gap-2.5 rounded-xl py-4">
                <CardContent className="flex flex-col gap-2.5 px-4">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-primary text-primary"
                      aria-hidden="true"
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="font-display text-lg font-extrabold text-primary">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <span className="text-[15px] leading-snug font-semibold">{title}</span>
                  <span className="text-sm leading-relaxed text-muted-foreground">{detail}</span>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </section>

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

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Film,
  Layers,
  Lock,
  MousePointerClick,
  Printer,
  ScanEye,
  Smartphone,
  Upload,
  X,
} from "lucide-react";
import { AccountMenu } from "@/components/AccountMenu";
import { AuthDialog } from "@/components/AuthDialog";
import { BrandMark } from "@/components/BrandMark";
import { ScoutCard } from "@/components/ScoutCard";
import { UploadDropzone } from "@/components/UploadDropzone";
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
import { useTeamAccount } from "@/lib/useTeamAccount";
import { buildCardFromDetection, type DetectedPlay } from "@/lib/videoImport";

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

const VIDEO_STEPS: { icon: typeof Upload; title: string; detail: string }[] = [
  {
    icon: Upload,
    title: "Upload one play's clip",
    detail:
      "Pick a short clip (10–20 seconds is plenty) of a single play, from a sideline or " +
      "endzone angle. It uploads straight to a private cloud file — never held in the app or " +
      "shown to anyone else.",
  },
  {
    icon: ScanEye,
    title: "AI analyzes the play",
    detail:
      "The AI reviews the clip and tracks each skill player — Q, F, H, X, Y, " +
      "Z — noting where they line up, where their route breaks, and where they end up.",
  },
  {
    icon: Film,
    title: "A card builds instantly",
    detail:
      "The formation, each player's route, and a route tag appear on a scout card right away " +
      "— the exact same card, Print Grid, and storage a CSV-imported play gets.",
  },
  {
    icon: MousePointerClick,
    title: "You correct it by dragging",
    detail:
      "The AI is reading camera angle and depth by eye, not measuring the field — it's a rough " +
      "starting point, not a measurement. Tap and drag any route's break point on the card to " +
      "match what you actually saw on tape.",
  },
];

export default function UploadPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ fileName: string; result: HudlParseResult } | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamBusy, setTeamBusy] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const account = useTeamAccount();

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

  const handleCreateTeam = async (event: React.FormEvent) => {
    event.preventDefault();
    setTeamBusy(true);
    setTeamError(null);
    try {
      const res = await fetch("/api/team/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: teamName }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setTeamError(payload.error ?? "Couldn't create that team.");
        return;
      }
      setCreateTeamOpen(false);
      setTeamName("");
      account.refresh();
    } catch {
      setTeamError("Couldn't create that team. Try again.");
    } finally {
      setTeamBusy(false);
    }
  };

  const handleSubscribe = async () => {
    setVideoBusy(true);
    setVideoError(null);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const payload = await res.json();
      if (!res.ok || !payload.url) {
        setVideoError(payload.error ?? "Couldn't start checkout.");
        setVideoBusy(false);
        return;
      }
      window.location.href = payload.url;
    } catch {
      setVideoError("Couldn't start checkout. Try again.");
      setVideoBusy(false);
    }
  };

  const handleUploadClick = () => {
    if (!account.configured || account.loading) return;
    if (!account.user) {
      setAuthOpen(true);
      return;
    }
    if (!account.team) {
      setCreateTeamOpen(true);
      return;
    }
    if (!account.entitled) {
      void handleSubscribe();
      return;
    }
    videoInput.current?.click();
  };

  const uploadButtonLabel = !account.configured
    ? "AI film import coming soon"
    : account.loading
      ? "Loading…"
      : videoBusy
        ? !account.user || !account.team
          ? "Working…"
          : !account.entitled
            ? "Redirecting to checkout…"
            : "Reading the clip…"
        : !account.user
          ? "Sign in to upload film"
          : !account.team
            ? "Create a team to continue"
            : !account.entitled
              ? "Subscribe to unlock AI film import"
              : "Upload game film";

  /**
   * Beta: upload a game clip straight to blob storage, send its URL to
   * `/api/parse-video` for AI route detection, and build a card from what
   * comes back. This is a rough, unverified detection meant to be corrected
   * on the card afterward — see `coordinateMapper.ts`'s doc comment.
   */
  const handleVideoFile = async (file: File) => {
    setVideoBusy(true);
    setVideoError(null);
    try {
      const { upload } = await import("@vercel/blob/client");
      // Private: opposing-team film shouldn't sit at a plain fetchable URL.
      // /api/parse-video authenticates when it fetches this server-side.
      const blob = await upload(file.name, file, {
        access: "private",
        handleUploadUrl: "/api/blob-upload",
      });

      const res = await fetch("/api/parse-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: blob.url, fileName: file.name }),
      });
      const payload = (await res.json()) as { detection?: DetectedPlay; fileName?: string; error?: string };
      if (!res.ok || !payload.detection) {
        setVideoError(payload.error ?? "The vision model couldn't read this clip.");
        return;
      }

      const card = buildCardFromDetection(payload.detection, payload.fileName ?? file.name);
      storeScript({
        fileName: "",
        films: [payload.fileName ?? file.name],
        savedAt: "",
        cards: [card],
        warnings: [
          "AI-detected routes are a rough starting point — drag each route's break points on " +
            "the card to correct them.",
        ],
      });
      router.push("/script?loaded=1");
    } catch {
      setVideoError("Couldn't process that clip. Try again, or use a shorter one.");
    } finally {
      setVideoBusy(false);
    }
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

          <Card className="gap-3 rounded-2xl border-2 border-primary/70 bg-primary/[0.07] py-5">
            <CardContent className="flex flex-col gap-3 px-5">
              <div className="flex flex-wrap items-center gap-2.5">
                <Badge className="h-6 rounded-full bg-primary px-2.5 text-xs font-extrabold tracking-[0.08em] text-primary-foreground">
                  NEW
                </Badge>
                <span className="text-sm font-bold tracking-[0.14em] text-primary">
                  NO HUDL BREAKDOWN? USE YOUR GAME FILM
                </span>
              </div>
              <h2 className="font-display text-2xl leading-tight font-extrabold uppercase sm:text-[28px]">
                Turn a game clip into a scout card
              </h2>
              <div className="flex flex-wrap items-center gap-4">
                <Button
                  size="lg"
                  className="w-fit"
                  disabled={videoBusy || account.loading || !account.configured}
                  onClick={handleUploadClick}
                >
                  <Film aria-hidden="true" />
                  {uploadButtonLabel}
                </Button>
                <button
                  type="button"
                  onClick={() => setHowItWorksOpen(true)}
                  className="text-sm font-bold text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
                >
                  How does this work?
                </button>
              </div>
              <p className="max-w-[540px] text-sm text-muted-foreground">
                AI-detected routes are a rough first pass — this clip is sent to a vision model for
                analysis, unlike the CSV above. You&apos;ll drag each route into shape on the card.
                A paid feature for your coaching staff: sign in, create or join your staff&apos;s
                team, and subscribe once to unlock it for everyone on the team.
              </p>
              {videoError && <p className="text-sm font-semibold text-destructive">{videoError}</p>}
              <input
                ref={videoInput}
                type="file"
                accept="video/mp4,video/quicktime,video/x-m4v"
                className="sr-only"
                aria-label="Upload a game clip"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleVideoFile(file);
                }}
              />
            </CardContent>
          </Card>
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

      <Dialog open={howItWorksOpen} onOpenChange={setHowItWorksOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl font-bold">
              How AI video import works
            </DialogTitle>
            <DialogDescription className="text-base">
              Four steps from a game clip to a card you can adjust and print.
            </DialogDescription>
          </DialogHeader>

          <ol className="flex flex-col gap-4">
            {VIDEO_STEPS.map(({ icon: Icon, title, detail }, i) => (
              <li key={title} className="flex gap-3.5">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-primary text-primary"
                  aria-hidden="true"
                >
                  <Icon className="size-[18px]" />
                </span>
                <div className="flex flex-col gap-0.5 pt-1">
                  <span className="font-display text-lg leading-none font-extrabold uppercase">
                    {String(i + 1)}. {title}
                  </span>
                  <span className="text-sm leading-relaxed text-muted-foreground">{detail}</span>
                </div>
              </li>
            ))}
          </ol>

          <p className="flex items-start gap-2 rounded-lg border bg-card p-3 text-sm leading-relaxed">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            Unlike the CSV importer above, your clip does leave the device — it&apos;s sent to an
            AI service for analysis. Don&apos;t upload film you&apos;re not allowed to share
            off-device.
          </p>
          <p className="flex items-start gap-2 rounded-lg border bg-card p-3 text-sm leading-relaxed">
            <Lock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            This is a paid feature, billed per coaching staff. Sign in, create (or join) your
            staff&apos;s team, and subscribe once — every coach on that team then gets AI film
            import. The CSV importer above stays free with no sign-in, always.
          </p>

          <DialogFooter>
            <Button size="lg" onClick={() => setHowItWorksOpen(false)}>
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />

      <Dialog open={createTeamOpen} onOpenChange={setCreateTeamOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Name your coaching staff</DialogTitle>
            <DialogDescription>
              This is the team your whole staff shares one subscription under. You can invite the
              rest of your coaches once it&apos;s created.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateTeam} className="flex flex-col gap-3">
            <input
              type="text"
              required
              autoFocus
              placeholder="e.g. Central High Football"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="h-11 rounded-md border-2 border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring"
            />
            {teamError && <p className="text-destructive text-sm">{teamError}</p>}
            <Button type="submit" size="lg" disabled={teamBusy}>
              {teamBusy ? "Creating…" : "Create team"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Film,
  Layers,
  Lock,
  MousePointerClick,
  Printer,
  RefreshCw,
  ScanEye,
  Smartphone,
  Sparkles,
  Upload,
  Users,
  X,
} from "lucide-react";
import { AccountMenu } from "@/components/AccountMenu";
import { BrandMark } from "@/components/BrandMark";
import { DeviceFrame } from "@/components/DeviceFrame";
import { HudlCsvMockup } from "@/components/HudlCsvMockup";
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

// Smash (X hitch, F corner — F is the slot in Deuces Gun, H stays in the
// backfield) to one side, curl-slide (Y slide, Z curl) to the other — a real
// two-concept passing play. The play call itself ("Deuces Gun 40 Smash") is
// the staff's actual name for it, not parseable route words, so each
// letter's route is set directly via routeOverrides instead of relying on
// routeCall to read it out of the play-call text.
const PREVIEW_CARD = {
  ...parseHudlCsvText(
    "PLAY #,DN,DIST,HASH,YARD LN,OFF FORM,OFF PLAY,DEF FRONT\n7,2,7,M,Opp 38,SPREAD,DEUCES GUN 40 SMASH,3-4\n",
  ).cards[0],
  routeOverrides: {
    X: { route: "hitch" },
    F: { route: "corner" },
    Y: { route: "slide" },
    Z: { route: "curl" },
  },
};

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

const PROBLEM_POINTS = [
  "Hours spent redrawing the same formations by hand, every single week",
  "Cards that look a little different depending on which coach made them",
  "No easy way to fix a card once it's already drawn or printed",
  "Film breakdown and scout cards living in two completely different tools",
];

const SOLUTION_POINTS = [
  "Cards generate straight from your Hudl tags — nobody draws a formation",
  "Every card uses the same formations, symbols, and layout, every time",
  "Edit any play, route, or note in seconds, right on the card itself",
  "One script: breakdown in, iPad-ready or printed cards out",
];

const FOUR_STEPS: { icon: typeof Upload; title: string; detail: string }[] = [
  {
    icon: Upload,
    title: "Upload",
    detail: "Drop this week's Hudl breakdown CSV — or a short game clip if you don't have one yet.",
  },
  {
    icon: Layers,
    title: "Generate",
    detail: "Formation, routes, blocking, and assignments turn into a vector scout card automatically.",
  },
  {
    icon: ClipboardCheck,
    title: "Review",
    detail: "Check each card, tweak an assignment, or drag an AI-detected route into shape.",
  },
  {
    icon: Smartphone,
    title: "Practice",
    detail: "Swipe through the script on the iPad at practice, or switch to Print Grid for paper.",
  },
];

const FEATURE_CARDS: { icon: typeof Upload; title: string; detail: string }[] = [
  {
    icon: ClipboardList,
    title: "For coaches",
    detail: "Turn a weekly breakdown into a full scout script in minutes, not a Saturday afternoon.",
  },
  {
    icon: Smartphone,
    title: "For players",
    detail:
      "Clean, high-contrast cards built for direct sun on an iPad — swipe through looks at their own pace.",
  },
  {
    icon: Printer,
    title: "Print-ready",
    detail: "2 or 4 cards to a page, black on white, ready to hand out or drop in a binder.",
  },
  {
    icon: Users,
    title: "Staff collaboration",
    detail: "Create a team for your staff, invite the other coaches, and everyone works from one script.",
  },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "Do I need Hudl to use this?",
    a: "Yes, for the free path — export your breakdown from Hudl as a CSV (Export → Breakdown / Data → CSV; the exact wording varies by Hudl version). ScoutCard AI reads that file directly in your browser.",
  },
  {
    q: "How accurate is the AI game-film analysis?",
    a: "It's a first-pass read, not a measurement. The AI is reading camera angle and depth by eye from a sideline or endzone clip, so treat every route as a starting point — you drag each break point into the correct shape before it's practice-ready.",
  },
  {
    q: "Can I edit a card after it's generated?",
    a: "Yes. Edit Play lets you change the formation, strength, play call, direction, hash, front, and coverage, plus each receiver's route. Edits save automatically and are marked \"edited\" in the play list.",
  },
  {
    q: "Can I print the scout cards?",
    a: "Yes. Print Grid lays out 2 or 4 cards per letter-size page, tuned for black-and-white printing, using your browser's normal Print / Save PDF.",
  },
  {
    q: "Does it work on an iPad?",
    a: "Yes — add it to your Home Screen from Safari and it keeps working offline after the first load, including whatever script you already imported.",
  },
  {
    q: "Do I have to upload game film?",
    a: "No. The CSV path is free and runs entirely in your browser — nothing is uploaded. AI film import is a separate, optional, paid feature for staffs that don't have a Hudl breakdown yet.",
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
    <div id="top" className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 flex h-[72px] shrink-0 items-center justify-between border-b bg-background/95 px-6 backdrop-blur lg:px-12">
        <a href="#top" className="shrink-0">
          <BrandMark />
        </a>
        <nav className="hidden items-center gap-8 text-[15px] font-semibold md:flex">
          <a href="#top" className="text-muted-foreground transition-colors hover:text-foreground">
            Home
          </a>
          <a href="#features" className="text-muted-foreground transition-colors hover:text-foreground">
            Features
          </a>
          <a href="#how-it-works" className="text-muted-foreground transition-colors hover:text-foreground">
            How it works
          </a>
          <a href="#faq" className="text-muted-foreground transition-colors hover:text-foreground">
            FAQ
          </a>
        </nav>
        <AccountMenu />
      </header>

      <main className="flex flex-col">
        {/* Hero */}
        <section className="px-6 pt-16 pb-4 sm:pt-20 lg:px-12 lg:pt-24">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
            <p className="animate-in fade-in slide-in-from-bottom-2 duration-500 text-sm font-bold tracking-[0.18em] text-primary">
              SCOUT CARDS FROM YOUR HUDL BREAKDOWN
            </p>
            <h1 className="animate-in fade-in slide-in-from-bottom-3 font-display text-5xl leading-[0.98] font-extrabold uppercase duration-700 sm:text-6xl lg:text-[72px]">
              Turn your Hudl breakdown into scout cards in seconds.
            </h1>
            <p className="animate-in fade-in slide-in-from-bottom-3 max-w-[620px] text-[19px] leading-relaxed text-[#c9cfc9] duration-700">
              Upload this week&apos;s CSV — or a game clip if you don&apos;t have one — and every play
              becomes a clean vector scout card, ready to run on the iPad at practice or print for the
              whole staff.
            </p>
            <div className="animate-in fade-in slide-in-from-bottom-3 flex flex-wrap items-center justify-center gap-3 duration-700">
              <Button size="xl" asChild>
                <a href="#upload">
                  Try ScoutCard AI
                  <ArrowRight aria-hidden="true" />
                </a>
              </Button>
              <Button size="xl" variant="outline" asChild>
                <a href="#showcase">See a sample card</a>
              </Button>
            </div>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Lock className="size-4" aria-hidden="true" />
              The CSV path is free and parsed on this device — nothing is uploaded.
            </p>
          </div>
        </section>

        {/* Functional upload — the actual product entry point */}
        <section id="upload" className="scroll-mt-20 px-6 py-10 lg:px-12 lg:py-14">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-14">
            <div className="flex min-w-0 flex-col gap-5">
              <UploadDropzone onFiles={handleFiles} onDemo={handleDemo} busy={busy} error={error} />
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Film className="size-4 shrink-0 text-primary" aria-hidden="true" />
                No breakdown handy?{" "}
                <a href="#ai-film" className="font-semibold text-primary underline-offset-4 hover:underline">
                  Use your game film instead
                </a>
                .
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-xs font-bold tracking-[0.14em] text-muted-foreground">LIVE PREVIEW</p>
              <ScoutCard card={PREVIEW_CARD} />
            </div>
          </div>
        </section>

        {/* AI game-film analysis */}
        <section id="ai-film" className="scroll-mt-20 border-t bg-card/30 px-6 py-16 sm:py-20 lg:px-12 lg:py-24">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <Badge className="mx-auto h-6 w-fit rounded-full bg-primary px-2.5 text-xs font-extrabold tracking-[0.08em] text-primary-foreground">
                NEW
              </Badge>
              <h2 className="mt-3 font-display text-3xl leading-tight font-extrabold uppercase sm:text-4xl">
                No breakdown yet? Use your game film
              </h2>
              <p className="mt-3 text-[17px] leading-relaxed text-muted-foreground">
                Upload a short clip of one play and AI builds a first-pass scout card for you to
                review — the same card, Print Grid, and iPad script a Hudl import gets.
              </p>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <Card className="gap-2.5 rounded-xl py-5">
                <CardContent className="flex flex-col gap-2.5 px-5">
                  <Film className="size-6 text-primary" aria-hidden="true" />
                  <span className="text-[15px] font-semibold">Upload one play&apos;s clip</span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    A sideline or endzone angle, 10–20 seconds, uploaded straight to a private file.
                  </span>
                </CardContent>
              </Card>
              <Card className="gap-2.5 rounded-xl py-5">
                <CardContent className="flex flex-col gap-2.5 px-5">
                  <ScanEye className="size-6 text-primary" aria-hidden="true" />
                  <span className="text-[15px] font-semibold">AI drafts the card</span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    Each skill player&apos;s alignment and route path is detected and drawn automatically.
                  </span>
                </CardContent>
              </Card>
              <Card className="gap-2.5 rounded-xl py-5">
                <CardContent className="flex flex-col gap-2.5 px-5">
                  <MousePointerClick className="size-6 text-primary" aria-hidden="true" />
                  <span className="text-[15px] font-semibold">You review and correct it</span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    It&apos;s a first pass, not a measurement — drag any route&apos;s break point into
                    shape before it&apos;s practice-ready.
                  </span>
                </CardContent>
              </Card>
            </div>

            <div className="mt-10 flex justify-center">
              <div className="w-full max-w-xl">
                <VideoUploadCard hideHeader />
              </div>
            </div>
          </div>
        </section>

        {/* Before / after */}
        <section id="showcase" className="scroll-mt-20 border-t px-6 py-16 sm:py-20 lg:px-12 lg:py-24">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-bold tracking-[0.18em] text-primary">FROM BREAKDOWN TO CARD</p>
              <h2 className="mt-2 font-display text-3xl leading-tight font-extrabold uppercase sm:text-4xl">
                The same play, two very different afternoons
              </h2>
              <p className="mt-3 text-[17px] leading-relaxed text-muted-foreground">
                One column of Hudl tags in, one clean vector scout card out — formation, routes, and
                blocking drawn for you, automatically.
              </p>
            </div>

            <div className="mt-10 grid items-center gap-6 lg:grid-cols-[1fr_auto_1fr]">
              <div className="flex flex-col gap-3">
                <p className="text-center text-xs font-bold tracking-[0.14em] text-muted-foreground">
                  YOUR HUDL BREAKDOWN
                </p>
                <HudlCsvMockup />
              </div>

              <div className="flex flex-col items-center justify-center gap-2">
                <span
                  className="flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-primary/10 text-primary"
                  aria-hidden="true"
                >
                  <Sparkles className="size-6" />
                </span>
                <ArrowRight className="size-6 shrink-0 rotate-90 text-muted-foreground" aria-hidden="true" />
              </div>

              <div className="flex flex-col gap-3">
                <p className="text-center text-xs font-bold tracking-[0.14em] text-muted-foreground">
                  PRACTICE-READY SCOUT CARD
                </p>
                <ScoutCard card={PREVIEW_CARD} />
              </div>
            </div>
          </div>
        </section>

        {/* Problem / solution */}
        <section className="border-t bg-card/30 px-6 py-16 sm:py-20 lg:px-12 lg:py-24">
          <div className="mx-auto max-w-5xl">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-bold tracking-[0.18em] text-primary">THE PROBLEM</p>
              <h2 className="mt-2 font-display text-3xl leading-tight font-extrabold uppercase sm:text-4xl">
                Stop spending hours drawing scout cards
              </h2>
            </div>

            <div className="mt-10 grid gap-6 sm:grid-cols-2">
              <Card className="gap-4 rounded-2xl border-destructive/30 py-6">
                <CardContent className="flex flex-col gap-4 px-6">
                  <div className="flex items-center gap-2.5">
                    <Clock className="size-5 text-destructive" aria-hidden="true" />
                    <span className="font-display text-lg font-extrabold uppercase tracking-wide text-destructive">
                      The old way
                    </span>
                  </div>
                  <ul className="flex flex-col gap-3">
                    {PROBLEM_POINTS.map((point) => (
                      <li key={point} className="flex gap-2.5 text-[15px] leading-snug text-muted-foreground">
                        <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              <Card className="gap-4 rounded-2xl border-2 border-primary/60 bg-primary/[0.06] py-6">
                <CardContent className="flex flex-col gap-4 px-6">
                  <div className="flex items-center gap-2.5">
                    <RefreshCw className="size-5 text-primary" aria-hidden="true" />
                    <span className="font-display text-lg font-extrabold uppercase tracking-wide text-primary">
                      With ScoutCard AI
                    </span>
                  </div>
                  <ul className="flex flex-col gap-3">
                    {SOLUTION_POINTS.map((point) => (
                      <li key={point} className="flex gap-2.5 text-[15px] leading-snug">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* iPad / practice experience */}
        <section className="border-t px-6 py-16 sm:py-20 lg:px-12 lg:py-24">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div className="flex flex-col gap-4">
              <p className="text-sm font-bold tracking-[0.18em] text-primary">ON THE FIELD</p>
              <h2 className="font-display text-3xl leading-tight font-extrabold uppercase sm:text-4xl">
                Built to run on the sideline
              </h2>
              <p className="max-w-[520px] text-[17px] leading-relaxed text-muted-foreground">
                Every card is high-contrast and vector-drawn for direct sun, not a screenshot. Swipe
                between plays, filter by down or formation, and switch between Scout Offense and Scout
                Defense without leaving the field.
              </p>
              <ul className="mt-2 flex flex-col gap-3">
                <li className="flex gap-2.5 text-[15px] leading-snug text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  Add to Home Screen and it keeps working offline once it&apos;s loaded once
                </li>
                <li className="flex gap-2.5 text-[15px] leading-snug text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  Filter by down, formation, or 7v7 / Team period mid-practice
                </li>
                <li className="flex gap-2.5 text-[15px] leading-snug text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  Not on the iPad? Switch to Print Grid for a paper script instead
                </li>
              </ul>
            </div>

            <div className="mx-auto w-full max-w-sm">
              <DeviceFrame>
                <ScoutCard card={PREVIEW_CARD} />
              </DeviceFrame>
            </div>
          </div>
        </section>

        {/* 4-step flow */}
        <section
          id="how-it-works"
          className="scroll-mt-20 border-t bg-card/30 px-6 py-16 sm:py-20 lg:px-12 lg:py-28"
        >
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-bold tracking-[0.18em] text-primary">HOW IT WORKS</p>
              <h2 className="mt-2 font-display text-4xl leading-tight font-extrabold uppercase sm:text-5xl">
                Upload. Generate. Review. Practice.
              </h2>
              <p className="mt-3 text-[17px] leading-relaxed text-muted-foreground">
                Four steps from a Hudl breakdown — or a game clip — to a script your whole staff can run.
              </p>
            </div>

            <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {FOUR_STEPS.map(({ icon: Icon, title, detail }, i) => (
                <li key={title}>
                  <Card className="h-full gap-4 overflow-hidden rounded-2xl border-2 py-8 transition-all hover:-translate-y-1.5 hover:border-primary/60">
                    <CardContent className="flex flex-col gap-3 px-7">
                      <span
                        className="font-display text-7xl leading-none font-extrabold text-primary/15"
                        aria-hidden="true"
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span
                        className="-mt-9 flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                        aria-hidden="true"
                      >
                        <Icon className="size-7" />
                      </span>
                      <span className="mt-1 font-display text-2xl font-extrabold uppercase">{title}</span>
                      <span className="text-[15px] leading-relaxed text-muted-foreground">{detail}</span>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Built for football staffs */}
        <section id="features" className="scroll-mt-20 border-t px-6 py-16 sm:py-20 lg:px-12 lg:py-24">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-bold tracking-[0.18em] text-primary">BUILT FOR FOOTBALL STAFFS</p>
              <h2 className="mt-2 font-display text-3xl leading-tight font-extrabold uppercase sm:text-4xl">
                Made for the whole program
              </h2>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURE_CARDS.map(({ icon: Icon, title, detail }) => (
                <Card
                  key={title}
                  className="h-full gap-3 rounded-2xl py-6 transition-transform hover:-translate-y-1"
                >
                  <CardContent className="flex flex-col gap-3 px-6">
                    <span
                      className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-primary text-primary"
                      aria-hidden="true"
                    >
                      <Icon className="size-5" />
                    </span>
                    <span className="font-display text-lg font-extrabold uppercase">{title}</span>
                    <span className="text-sm leading-relaxed text-muted-foreground">{detail}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 border-t px-6 py-16 sm:py-20 lg:px-12 lg:py-24">
          <div className="mx-auto max-w-3xl">
            <div className="text-center">
              <p className="text-sm font-bold tracking-[0.18em] text-primary">FAQ</p>
              <h2 className="mt-2 font-display text-3xl leading-tight font-extrabold uppercase sm:text-4xl">
                Common questions
              </h2>
            </div>

            <div className="mt-10 flex flex-col gap-3">
              {FAQS.map(({ q, a }) => (
                <details key={q} className="group rounded-xl border bg-card px-5 py-4 open:pb-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-semibold marker:content-none">
                    {q}
                    <ChevronDown
                      className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="border-t px-6 py-16 sm:py-20 lg:px-12 lg:py-24">
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-5 text-center">
            <h2 className="font-display text-4xl leading-tight font-extrabold uppercase sm:text-5xl">
              Stop drawing cards. Start repping looks.
            </h2>
            <p className="max-w-[480px] text-[17px] leading-relaxed text-muted-foreground">
              Drop this week&apos;s Hudl breakdown and see your first scout card in seconds.
            </p>
            <Button size="xl" asChild>
              <a href="#upload">
                Try ScoutCard AI
                <ArrowRight aria-hidden="true" />
              </a>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t px-6 py-8 lg:px-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <BrandMark />
          <p className="text-sm text-muted-foreground">Built for high school football staffs.</p>
        </div>
      </footer>

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

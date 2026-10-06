"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Download,
  Film,
  Layers,
  Lock,
  Play,
  Printer,
  BookOpen,
  Smartphone,
  Sparkles,
  Upload,
  Users,
  X,
} from "lucide-react";
import { AccountMenu } from "@/components/AccountMenu";
import { BrandMark } from "@/components/BrandMark";
import { AppGate } from "@/components/AppGate";
import { UploadDropzone } from "@/components/UploadDropzone";
import { BatchUploader } from "@/components/BatchUploader";
import { VideoUploadCard } from "@/components/VideoUploadCard";
import { FilmToCardVisual } from "@/components/landing/FilmToCardVisual";
import { HeroDevice } from "@/components/landing/HeroDevice";
import { HudlExportGuide } from "@/components/landing/HudlExportGuide";
import { PracticeShowcase } from "@/components/landing/PracticeShowcase";
import { Reveal, SectionHeading, TryCta } from "@/components/landing/primitives";
import { TransformShowcase } from "@/components/landing/TransformShowcase";
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
import { isFilmImportEnabled } from "@/lib/featureFlags";
import { importFilms } from "@/lib/importFilms";
import { PLAYBOOK_TEMPLATE_CSV, PLAYBOOK_TEMPLATE_NAME } from "@/lib/playbookTemplate";
import { loadScript, saveScript, storeScript } from "@/lib/scriptStore";
import { computeTendencies } from "@/lib/tendencies";

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

// Every card the page shows is parsed from real demo rows by the real parser.
const DEMO_CARDS = parseHudlCsvText(MOCK_HUDL_CSV).cards;
const HERO_CARDS = [PREVIEW_CARD, ...DEMO_CARDS];
const HERO_TENDENCIES = computeTendencies(HERO_CARDS);

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
  "Hours redrawing the same formations every week",
  "Cards that vary with whichever coach drew them",
  "No easy fix once a card is drawn or printed",
  "Breakdown and cards in two separate tools",
];

const SOLUTION_POINTS = [
  "Cards generate straight from your Hudl tags",
  "Same formations, symbols, and layout every time",
  "Edit any play, route, or note right on the card",
  "One script: iPad-ready or printed",
];

/** AI film-to-card is hidden unless NEXT_PUBLIC_FILM_IMPORT=true (src/lib/featureFlags.ts). */
const FILM = isFilmImportEnabled();

const FOUR_STEPS: { icon: typeof Upload; title: string; detail: string }[] = [
  { icon: Upload, title: "Upload", detail: FILM ? "Drop this week's Hudl export — or a game clip." : "Drop this week's Hudl export." },
  { icon: Layers, title: "Generate", detail: "Formation, routes, blocking, and assignments draw themselves." },
  { icon: ClipboardCheck, title: "Review", detail: FILM ? "Tweak an assignment or drag an AI route into shape." : "Tweak an assignment or a route to match your call." },
  { icon: Smartphone, title: "Practice", detail: "Swipe it on the iPad, or print 2 or 4 to a page." },
];

const FEATURE_CARDS: { icon: typeof Upload; title: string; detail: string }[] = [
  { icon: ClipboardList, title: "For coaches", detail: "A full scout script in minutes, not a Saturday afternoon." },
  { icon: Smartphone, title: "For players", detail: "High-contrast cards built for direct sun on an iPad." },
  { icon: Printer, title: "Print-ready", detail: "2 or 4 cards a page, black on white, binder-ready." },
  { icon: Users, title: "Staff collaboration", detail: "Invite your coaches and work from one script." },
];

/** How the AI is used on scout cards (src/lib/importReview.ts, /api/review-import): the CSV stays in charge. */
const AI_POINTS: { icon: typeof Upload; title: string; detail: string }[] = [
  {
    icon: ClipboardCheck,
    title: "Your tags win",
    detail:
      "Formation, front, play call, hash and direction come straight from your breakdown. The AI is only asked about a play the app can't place: a formation name it doesn't know, or a call that isn't clearly a run or a pass.",
  },
  {
    icon: Sparkles,
    title: "AI fills the gaps",
    detail:
      "It maps that name onto the app's own formations and fronts. For a pass with a single route word, it builds the concept: a route for each position from your route tree, not one route repeated for everyone.",
  },
  {
    icon: Check,
    title: "Checked, then marked",
    detail:
      "Every answer is checked against the shapes the app can draw before it's used. Plays the AI touched are tagged \"AI\" with a notice to look them over, and any route can be changed in Edit play.",
  },
];

const ABOUT_POINTS: { icon: typeof Upload; title: string; detail: string }[] = [
  { icon: Layers, title: "Real coaching conventions", detail: "Q/F/H/X/Y/Z, your route tree, real run schemes." },
  { icon: Clock, title: "Minutes, not a late night", detail: "Every card draws itself from the breakdown." },
  { icon: Smartphone, title: "Built for the field", detail: "Works offline and reads in direct sunlight." },
  FILM
    ? { icon: Sparkles, title: "AI when you need it", detail: "No breakdown? Start from the film instead." }
    : { icon: Sparkles, title: "AI where it helps", detail: "Checks your breakdown and fills in the concepts it can't place." },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "How do I get my breakdown out of Hudl?",
    a: "Open the opponent's film, find the data grid under the video, click the ⋯ menu at the right end of its toolbar, and choose Export Data to Excel. Drop that file straight in — .xlsx and .csv both work. The video needs breakdown data tagged on it, and your account needs coach or admin access to export.",
  },
  ...(FILM
    ? [
        {
          q: "How accurate is the AI game-film analysis?",
          a: "It's a first-pass read, not a measurement. The AI reads camera angle and depth by eye from a sideline or endzone clip, so treat every route as a starting point — drag each break point into shape before it's practice-ready.",
        },
      ]
    : []),
  {
    q: "Does the AI change my breakdown?",
    a: "No. Your tags always win. The AI only looks at plays the app can't place on its own, like a formation name it doesn't know or a call that isn't clearly a run or a pass, and it fills in only what the file left open. Anything it filled in is tagged \"AI\" with a notice to check it, and if it can't be reached the cards draw exactly as your file reads.",
  },
  {
    q: "Can I edit a card after it's generated?",
    a: "Yes. Edit Play changes the formation, strength, play call, direction, hash, front, coverage, and each receiver's route. Edits save automatically and are marked \"edited\" in the play list.",
  },
  {
    q: "Can I print the scout cards?",
    a: "Yes. Print Grid lays out 2 or 4 cards per letter-size page, tuned for black-and-white printing, through your browser's Print / Save PDF.",
  },
  {
    q: "Does it work with The CoachPad or other sideline tablets?",
    a: "Yes — as the card maker upstream of it. In Print Grid, choose CoachPad / tablet to export every card in your current view as one PDF (a page per card) or a set of numbered images, sized for a 13.3″ 4:3 screen. Then load that file onto the CoachPad the way you already load files: cloud sync or USB. There are iPad and letter-paper sizes too. ScoutCard AI isn't affiliated with The CoachPad; it just makes files it can open.",
  },
  {
    q: "Can the cards be read in direct sunlight?",
    a: "Turn on Sunlight in the card view and every card goes pure black on white with thicker lines — no red or orange to wash out on a bright field screen. Sideline exports use Sunlight mode by default.",
  },
  {
    q: "Does it work on an iPad?",
    a: "Yes — add it to your Home Screen from Safari and it keeps working offline after the first load, including the script you already imported.",
  },
  {
    q: "Do I have to upload game film?",
    a: FILM
      ? "No. Your Hudl export is read entirely in your browser — nothing is uploaded. AI film import is a separate, optional, paid feature for staffs without a breakdown yet."
      : "No. Your Hudl export is read entirely in your browser — nothing is uploaded. The cards come from your breakdown, which Hudl already tags from the film.",
  },
];

const NAV = [
  ["#top", "Home"],
  ["#features", "Features"],
  ["#how-it-works", "How it works"],
  ["#about", "About"],
  ["#faq", "FAQ"],
] as const;

const SECTION = "scroll-mt-20 border-t px-5 py-20 sm:px-6 sm:py-28 lg:px-12";

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

  // The staff's own playbook: same readers, its own storage slot, studied at /script?playbook=1.
  const [savedPlaybook, setSavedPlaybook] = useState<number | null>(null);
  useEffect(() => setSavedPlaybook(loadScript("playbook")?.cards.length ?? null), []);

  const handlePlaybookFiles = async (files: File[]) => {
    setBusy(true);
    setError(null);
    try {
      const imported = await importFilms(files);
      if (imported.cards.length > 0) {
        storeScript(
          { fileName: "", films: imported.films, savedAt: "", cards: imported.cards, warnings: imported.warnings },
          "playbook",
        );
        router.push("/script?playbook=1&loaded=1");
        return;
      }
      const [first] = imported.failed;
      setReport({
        fileName: files.length > 1 ? `${first.name} (and ${files.length - 1} more)` : first.name,
        result: first.result,
      });
    } catch {
      setError("Couldn't read those files. Save the sheet as .xlsx or CSV and try again.");
    } finally {
      setBusy(false);
    }
  };

  const handlePlaybookPaste = (text: string) => {
    const result = parseHudlCsvText(text);
    if (result.cards.length > 0) {
      saveScript("Pasted playbook", result, "playbook");
      router.push("/script?playbook=1&loaded=1");
      return;
    }
    setReport({ fileName: "Pasted playbook", result });
  };

  const downloadPlaybookTemplate = () => {
    const url = URL.createObjectURL(new Blob([PLAYBOOK_TEMPLATE_CSV], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = PLAYBOOK_TEMPLATE_NAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const handleDemo = () => {
    saveScript(DEMO_FILE_NAME, parseHudlCsvText(MOCK_HUDL_CSV));
    router.push("/script");
  };

  const handlePasteText = (text: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = parseHudlCsvText(text);
      if (result.cards.length > 0) {
        storeScript({
          fileName: "",
          films: ["Pasted breakdown"],
          savedAt: "",
          cards: result.cards.map((c) => ({ ...c, source: c.source || "Pasted breakdown" })),
          warnings: result.warnings,
        });
        router.push("/script?loaded=1");
        return;
      }
      setReport({ fileName: "Pasted breakdown", result });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="top" className="flex min-h-dvh flex-col overflow-x-clip">
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-4 px-5 sm:px-6 lg:px-12">
          <a href="#top" className="shrink-0" aria-label="ScoutCard AI home">
            <BrandMark />
          </a>
          <nav className="hidden items-center gap-8 text-[15px] font-semibold lg:flex">
            {NAV.map(([href, label]) => (
              <a key={href} href={href} className="text-muted-foreground transition-colors hover:text-foreground">
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <AccountMenu />
            <TryCta compact className="hidden sm:inline-flex" />
          </div>
        </div>
      </header>

      <main className="flex flex-col">
        {/* Hero */}
        <section className="relative isolate px-5 pt-14 pb-20 sm:px-6 sm:pt-20 lg:px-12 lg:pt-24 lg:pb-28">
          <div
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_70%_30%,rgba(255,138,61,0.14),transparent_70%),linear-gradient(to_bottom,transparent,var(--background))]"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute inset-0 -z-20 bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_71px,rgba(244,241,232,0.035)_71px,rgba(244,241,232,0.035)_72px)] [mask-image:radial-gradient(70%_60%_at_50%_40%,black,transparent)]"
            aria-hidden="true"
          />
          <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
            <div className="flex flex-col items-center gap-7 text-center lg:items-start lg:text-left">
              <p className="animate-in fade-in slide-in-from-bottom-2 flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1.5 text-[11px] font-bold tracking-[0.12em] whitespace-nowrap text-primary duration-500 sm:text-xs sm:tracking-[0.16em]">
                <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                SCOUT CARDS FROM YOUR HUDL BREAKDOWN
              </p>
              <h1 className="animate-in fade-in slide-in-from-bottom-3 font-display text-[52px] leading-[0.9] font-extrabold uppercase duration-700 sm:text-7xl xl:text-[88px]">
                Turn your Hudl breakdown into scout cards <span className="text-primary">in seconds.</span>
              </h1>
              <p className="animate-in fade-in slide-in-from-bottom-3 max-w-[520px] text-lg leading-relaxed text-[#c9cfc9] duration-700 sm:text-xl">
                Every play becomes a clean, practice-ready card — on the iPad at practice or printed for the
                whole staff.
              </p>
              <div className="animate-in fade-in slide-in-from-bottom-4 flex w-full max-w-sm flex-col items-stretch gap-3 duration-1000 sm:w-auto sm:max-w-none sm:flex-row sm:items-center sm:justify-center lg:justify-start">
                <TryCta />
                <Button size="xl" variant="outline" asChild className="h-14 rounded-xl border-white/15 px-6 hover:border-white/30 hover:bg-white/5">
                  <a href="#showcase">See how it works</a>
                </Button>
              </div>
              <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground lg:justify-start">
                <Lock className="size-4 shrink-0" aria-hidden="true" />
                Read on your device. Nothing is uploaded.
              </p>
            </div>

            <div className="animate-in fade-in zoom-in-95 mx-auto w-full max-w-[680px] duration-1000 lg:max-w-none">
              <HeroDevice cards={HERO_CARDS} tendencies={HERO_TENDENCIES} />
            </div>
          </div>
        </section>

        {/* Functional upload — the actual product entry point */}
        <section id="upload" className={`${SECTION} bg-card/30`}>
          <div className="mx-auto max-w-6xl">
            <Reveal>
              <SectionHeading eyebrow="START HERE" title="Drop in this week's breakdown">
                Export from Hudl, drop the file, and your script is ready.
              </SectionHeading>
            </Reveal>
            <div className="mt-12 grid items-start gap-8 lg:grid-cols-2 lg:gap-10">
              <Reveal className="lg:order-2 lg:sticky lg:top-24">
                <AppGate
                  variant="section"
                  lockedActions={
                    <Button size="xl" variant="outline" onClick={handleDemo}>
                      Try the 5-play demo
                    </Button>
                  }
                >
                <div className="flex flex-col gap-4">
                  <UploadDropzone
                    onFiles={handleFiles}
                    onDemo={handleDemo}
                    onPasteText={handlePasteText}
                    busy={busy}
                    error={error}
                  />
                  {FILM && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Film className="size-4 shrink-0 text-primary" aria-hidden="true" />
                      No breakdown handy?{" "}
                      <a href="#ai-film" className="font-semibold text-primary underline-offset-4 hover:underline">
                        Use your game film instead
                      </a>
                    </p>
                  )}
                  <div className="mt-2 flex flex-col gap-3 rounded-2xl border bg-background/50 p-5">
                    <p className="text-xs font-bold tracking-[0.16em] text-muted-foreground">WORKS WITH</p>
                    <div className="flex flex-wrap gap-2">
                      {[".csv", ".xlsx", "Pasted rows", "Several films at once"].map((f) => (
                        <span key={f} className="rounded-lg border bg-card px-3 py-1.5 font-mono text-[13px] font-semibold">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                </AppGate>
              </Reveal>
              <Reveal delay={120} className="lg:order-1">
                <HudlExportGuide />
              </Reveal>
            </div>
          </div>
        </section>

        {/* Our own playbook: the staff's plays aren't in Hudl, so they upload them to study. */}
        <section id="playbook" className={`${SECTION} bg-card/30`}>
          <div className="mx-auto max-w-6xl">
            <Reveal>
              <SectionHeading
                eyebrow="YOUR OWN PLAYS"
                title={
                  <>
                    Study <span className="text-primary">your playbook</span>
                  </>
                }
              >
                Your own plays aren&apos;t in Hudl, so put them here. Upload a sheet of your plays and flip through
                them on the iPad, kept apart from this week&apos;s scout script.
              </SectionHeading>
            </Reveal>
            <div className="mt-12 grid items-start gap-8 lg:grid-cols-2 lg:gap-10">
              <Reveal>
                <div className="flex flex-col gap-5 rounded-3xl border bg-card p-7">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
                    <BookOpen className="size-6" aria-hidden="true" />
                  </span>
                  <p className="font-display text-2xl font-extrabold uppercase">What goes in the sheet</p>
                  <ul className="flex flex-col gap-3 text-[15px] leading-relaxed text-muted-foreground">
                    <li className="flex gap-3">
                      <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>
                        One row per play: the <strong className="text-foreground">formation</strong> and the{" "}
                        <strong className="text-foreground">play call</strong>, like &ldquo;TRIPS · QUICK SLANT&rdquo;.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>Optional: strength (L / R) and play direction (L / R). No down, distance or yard line needed.</span>
                    </li>
                    <li className="flex gap-3">
                      <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>
                        Same columns as a Hudl export, so the cards draw exactly like the scout cards. Your own
                        names for formations are read too.
                      </span>
                    </li>
                  </ul>
                  <div className="flex flex-wrap gap-3">
                    <Button size="lg" variant="outline" onClick={downloadPlaybookTemplate}>
                      <Download aria-hidden="true" />
                      Get the template
                    </Button>
                    {savedPlaybook !== null && (
                      <Button size="lg" onClick={() => router.push("/script?playbook=1")}>
                        <BookOpen aria-hidden="true" />
                        Open your playbook · {savedPlaybook} {savedPlaybook === 1 ? "play" : "plays"}
                      </Button>
                    )}
                  </div>
                </div>
              </Reveal>
              <Reveal delay={120}>
                <AppGate variant="section">
                  <div className="flex flex-col gap-3">
                    <UploadDropzone
                      onFiles={handlePlaybookFiles}
                      onPasteText={handlePlaybookPaste}
                      busy={busy}
                      error={error}
                      title="Drop your playbook .csv or .xlsx here"
                      hint={
                        savedPlaybook !== null
                          ? "A new upload replaces your saved playbook. Add more plays later from the playbook itself."
                          : "One row per play: formation and play call."
                      }
                      noun="playbook"
                    />
                  </div>
                </AppGate>
              </Reveal>
            </div>
          </div>
        </section>

        {/* AI game-film analysis (hidden unless NEXT_PUBLIC_FILM_IMPORT=true) */}
        {FILM && (
        <section id="ai-film" className={SECTION}>
          <div className="mx-auto max-w-6xl">
            <Reveal>
              <SectionHeading
                eyebrow="NEW · AI GAME FILM"
                title={
                  <>
                    No breakdown? <span className="text-primary">Use the film.</span>
                  </>
                }
              >
                Upload one play&apos;s clip. AI drafts the card — you drag it into shape.
              </SectionHeading>
            </Reveal>
            <Reveal delay={100} className="mt-14">
              <FilmToCardVisual />
            </Reveal>
            <Reveal
              delay={150}
              className="mx-auto mt-14 grid max-w-5xl items-start gap-4 lg:grid-cols-2 lg:[&>*:only-child]:col-span-2 lg:[&>*:only-child]:mx-auto lg:[&>*:only-child]:w-full lg:[&>*:only-child]:max-w-xl"
            >
              <AppGate variant="section">
                <VideoUploadCard hideHeader />
              </AppGate>
              <AppGate variant="section">
                <BatchUploader />
              </AppGate>
            </Reveal>
          </div>
        </section>
        )}

        {/* How the AI is used on the cards */}
        <section id="ai" className={SECTION}>
          <div className="mx-auto max-w-6xl">
            <Reveal>
              <SectionHeading eyebrow="HOW THE AI HELPS" title={<>Your tags first. <span className="text-primary">AI only fills the gaps.</span></>}>
                Cards draw from your Hudl breakdown. When a row has a name the app doesn&apos;t know, the AI reads
                it and fills in the blanks, and you can see exactly what it touched.
              </SectionHeading>
            </Reveal>
            <ol className="mt-14 grid gap-4 lg:grid-cols-3">
              {AI_POINTS.map(({ icon: Icon, title, detail }, i) => (
                <li key={title}>
                  <Reveal delay={i * 90} className="h-full">
                    <div className="flex h-full flex-col gap-3 rounded-3xl border bg-card p-7 transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/50">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
                        <Icon className="size-6" aria-hidden="true" />
                      </span>
                      <span className="mt-2 font-display text-2xl font-extrabold uppercase">{title}</span>
                      <span className="text-[15px] leading-relaxed text-muted-foreground">{detail}</span>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ol>
            <Reveal delay={200}>
              <p className="mx-auto mt-8 max-w-3xl rounded-2xl border bg-background/50 px-5 py-4 text-center text-[15px] leading-relaxed text-muted-foreground">
                Only the plays the app can&apos;t place are sent, as text, never your whole file or any film. If the AI
                isn&apos;t reachable, the cards draw exactly as your breakdown reads. You can also type a play call
                and have the AI draw it.
              </p>
            </Reveal>
          </div>
        </section>

        {/* Before / after */}
        <section id="showcase" className={`${SECTION} bg-card/30`}>
          <div className="mx-auto max-w-6xl">
            <Reveal>
              <SectionHeading eyebrow="FROM BREAKDOWN TO CARD" title="One row in. One card out.">
                Every tag in your breakdown lands exactly where it belongs on the card.
              </SectionHeading>
            </Reveal>
            <Reveal delay={100} className="mt-14">
              <TransformShowcase card={DEMO_CARDS[1]} />
            </Reveal>
          </div>
        </section>

        {/* Problem / solution */}
        <section className={SECTION}>
          <div className="mx-auto max-w-5xl">
            <Reveal>
              <SectionHeading eyebrow="THE PROBLEM" title="Stop drawing scout cards by hand" />
            </Reveal>
            <div className="mt-12 grid gap-5 sm:grid-cols-2">
              <Reveal>
                <div className="flex h-full flex-col gap-5 rounded-3xl border bg-card/50 p-7">
                  <span className="flex items-center gap-2.5 font-display text-xl font-extrabold tracking-wide text-muted-foreground uppercase">
                    <Clock className="size-5 text-destructive" aria-hidden="true" />
                    The old way
                  </span>
                  <ul className="flex flex-col gap-3.5">
                    {PROBLEM_POINTS.map((point) => (
                      <li key={point} className="flex gap-3 text-[15px] leading-snug text-muted-foreground">
                        <X className="mt-0.5 size-4 shrink-0 text-destructive/80" aria-hidden="true" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
              <Reveal delay={120}>
                <div className="relative flex h-full flex-col gap-5 overflow-hidden rounded-3xl border border-primary/40 bg-gradient-to-br from-primary/[0.14] to-primary/[0.03] p-7 shadow-[0_20px_60px_-30px] shadow-primary/50">
                  <span className="flex items-center gap-2.5 font-display text-xl font-extrabold tracking-wide text-primary uppercase">
                    <Sparkles className="size-5" aria-hidden="true" />
                    With ScoutCard AI
                  </span>
                  <ul className="flex flex-col gap-3.5">
                    {SOLUTION_POINTS.map((point) => (
                      <li key={point} className="flex gap-3 text-[15px] leading-snug font-medium">
                        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                        </span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* iPad / practice experience */}
        <section className={`${SECTION} bg-card/30`}>
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
            <Reveal>
              <div className="flex flex-col gap-6">
                <SectionHeading eyebrow="AT PRACTICE" title="Built to run in practice" align="left">
                  High-contrast vector cards made for direct sun. Swipe plays, filter by down or formation,
                  and flip between Scout O and Scout D.
                </SectionHeading>
                <ul className="flex flex-col gap-3">
                  {[
                    "Runs off your playsheet: Scout D follows your calls, period by period",
                    "Works offline from the Home Screen",
                    "Filter by down, formation, or 7v7 / Team",
                    "Print Grid: 2 or 4 cards a page",
                  ].map((item) => (
                    <li key={item} className="flex gap-3 text-[15px] leading-snug">
                      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                        <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
            <Reveal delay={120}>
              <PracticeShowcase cards={DEMO_CARDS} />
            </Reveal>
          </div>
        </section>

        {/* 4-step flow */}
        <section id="how-it-works" className={SECTION}>
          <div className="mx-auto max-w-6xl">
            <Reveal>
              <SectionHeading eyebrow="HOW IT WORKS" title="Upload. Generate. Review. Practice.">
                {FILM ? "From a Hudl breakdown — or a game clip — to a script your whole staff can run." : "From a Hudl breakdown to a script your whole staff can run."}
              </SectionHeading>
            </Reveal>
            <div className="relative mt-14">
              <div
                className="absolute top-[56px] right-[12%] left-[12%] hidden h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent lg:block"
                aria-hidden="true"
              />
              <ol className="relative grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {FOUR_STEPS.map(({ icon: Icon, title, detail }, i) => (
                  <li key={title}>
                    <Reveal delay={i * 90} className="h-full">
                      <div className="group relative flex h-full flex-col gap-3 rounded-3xl border bg-card p-7 transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/50">
                        <div className="flex items-center justify-between">
                          <span className="relative flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
                            <Icon className="size-7" aria-hidden="true" />
                          </span>
                          <span className="font-display text-5xl leading-none font-extrabold text-white/[0.07] transition-colors group-hover:text-primary/25">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                        </div>
                        <span className="mt-2 font-display text-2xl font-extrabold uppercase">{title}</span>
                        <span className="text-[15px] leading-relaxed text-muted-foreground">{detail}</span>
                      </div>
                    </Reveal>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Built for football staffs */}
        <section id="features" className={`${SECTION} bg-card/30`}>
          <div className="mx-auto max-w-6xl">
            <Reveal>
              <SectionHeading eyebrow="BUILT FOR FOOTBALL STAFFS" title="Made for the whole program" />
            </Reveal>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURE_CARDS.map(({ icon: Icon, title, detail }, i) => (
                <Reveal key={title} delay={i * 80} className="h-full">
                  <div className="flex h-full flex-col gap-3 rounded-3xl border bg-background/60 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40">
                    <span className="flex size-11 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/25">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <span className="mt-1 font-display text-xl font-extrabold uppercase">{title}</span>
                    <span className="text-[15px] leading-relaxed text-muted-foreground">{detail}</span>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* About / why */}
        <section id="about" className={SECTION}>
          <div className="mx-auto max-w-5xl">
            <Reveal>
              <SectionHeading eyebrow="WHY SCOUTCARD AI" title="Built from the sideline, not a boardroom" />
            </Reveal>
            <Reveal delay={100}>
              <figure className="relative mx-auto mt-12 max-w-3xl overflow-hidden rounded-3xl border bg-gradient-to-br from-card to-background p-8 sm:p-12">
                <span
                  className="pointer-events-none absolute -top-6 left-6 font-display text-[160px] leading-none font-extrabold text-primary/15 select-none"
                  aria-hidden="true"
                >
                  &ldquo;
                </span>
                <blockquote className="relative text-xl leading-relaxed text-[#dfe3de] sm:text-[22px]">
                  I played high school football, and I watched our coaching staff stay late hand-drawing scout
                  team cards off a stack of Hudl printouts — hours that should&apos;ve gone into actual
                  gameplanning, film work, or just going home. That&apos;s the whole reason this exists: turn a
                  breakdown into practice-ready cards in minutes, so a coordinator can walk out of the office
                  instead of tracing X&apos;s and O&apos;s by hand.
                </blockquote>
                <figcaption className="relative mt-7 flex items-center gap-3">
                  <span className="h-px w-8 bg-primary" aria-hidden="true" />
                  <span className="font-bold">Jake</span>
                  <span className="text-muted-foreground">Founder</span>
                </figcaption>
              </figure>
            </Reveal>
            <ul className="mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
              {ABOUT_POINTS.map(({ icon: Icon, title, detail }, i) => (
                <li key={title}>
                  <Reveal delay={i * 80} className="flex flex-col gap-2">
                    <Icon className="size-5 text-primary" aria-hidden="true" />
                    <span className="font-display text-lg font-extrabold uppercase">{title}</span>
                    <span className="text-sm leading-relaxed text-muted-foreground">{detail}</span>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className={`${SECTION} bg-card/30`}>
          <div className="mx-auto max-w-3xl">
            <Reveal>
              <SectionHeading eyebrow="FAQ" title="Common questions" />
            </Reveal>
            <Reveal delay={100} className="mt-12 flex flex-col gap-3">
              {FAQS.map(({ q, a }) => (
                <details
                  key={q}
                  className="group rounded-2xl border bg-background/60 px-6 py-5 transition-colors open:border-primary/40 open:bg-background hover:border-white/15"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-semibold marker:content-none">
                    {q}
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors group-open:border-primary/50 group-open:bg-primary/10">
                      <ChevronDown
                        className="size-4 text-muted-foreground transition-transform duration-300 group-open:rotate-180 group-open:text-primary"
                        aria-hidden="true"
                      />
                    </span>
                  </summary>
                  <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-muted-foreground">{a}</p>
                </details>
              ))}
            </Reveal>
          </div>
        </section>

        {/* Final CTA */}
        <section className="border-t px-5 py-20 sm:px-6 sm:py-28 lg:px-12">
          <Reveal className="mx-auto max-w-5xl">
            <div className="relative isolate overflow-hidden rounded-[32px] border border-primary/30 bg-gradient-to-b from-primary/[0.16] via-card to-card px-6 py-16 text-center sm:px-12 sm:py-20">
              <div
                className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-72 w-[80%] -translate-x-1/2 rounded-full bg-primary/25 blur-3xl"
                aria-hidden="true"
              />
              <h2 className="mx-auto max-w-3xl font-display text-[44px] leading-[0.92] font-extrabold uppercase sm:text-6xl lg:text-7xl">
                Stop drawing cards. <span className="text-primary">Start repping looks.</span>
              </h2>
              <p className="mx-auto mt-5 max-w-md text-lg leading-relaxed text-muted-foreground">
                Drop this week&apos;s Hudl export and see your first scout card in seconds.
              </p>
              <div className="mx-auto mt-9 flex max-w-sm flex-col items-stretch gap-3 sm:max-w-none sm:flex-row sm:items-center sm:justify-center">
                <TryCta />
                <Button
                  size="xl"
                  variant="outline"
                  onClick={handleDemo}
                  className="h-14 rounded-xl border-white/15 px-6 hover:border-white/30 hover:bg-white/5"
                >
                  <Play className="fill-current" aria-hidden="true" />
                  Load the demo script
                </Button>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t px-5 py-10 sm:px-6 lg:px-12">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-5 sm:flex-row">
          <BrandMark />
          <p className="text-sm text-muted-foreground">Built for high school football staffs.</p>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <a href="/privacy" className="transition-colors hover:text-foreground">
              Privacy
            </a>
            <a href="/terms" className="transition-colors hover:text-foreground">
              Terms
            </a>
          </div>
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

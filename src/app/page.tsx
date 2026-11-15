import Link from "next/link";
import {
  ArrowRight,
  Layers,
  Lock,
  PenLine,
  Printer,
  Shield,
  Smartphone,
  Swords,
  Users,
  WifiOff,
} from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { LandingUpload } from "@/components/LandingUpload";
import { ScoutCard } from "@/components/ScoutCard";
import { parseHudlCsvText } from "@/lib/hudlParser";

const SAMPLE_ROW = {
  "PLAY #": "7",
  DN: "3",
  DIST: "6",
  HASH: "L",
  "YARD LN": "-35",
  "OFF FORM": "TRIPS RT",
  "OFF PLAY": "4 VERTS",
  "DEF FRONT": "4-3",
};

const PREVIEW_CARD = parseHudlCsvText(
  `${Object.keys(SAMPLE_ROW).join(",")}\n${Object.values(SAMPLE_ROW).join(",")}\n`,
).cards[0];

const STEPS = [
  { title: "Export from Hudl", body: "Open the game you broke down and export the breakdown data as a CSV." },
  { title: "Drop it in", body: "Every play is read on this device and drawn as a card in about a second." },
  { title: "Run the script", body: "Flip through on the iPad at practice, or print 2 or 4 to a page." },
];

const FEATURES = [
  {
    icon: Swords,
    title: "Scout offense",
    body: "Routes, blocking and the ball carrier’s path, drawn from the play call. Tree numbers like 2960 read right to left.",
  },
  {
    icon: Shield,
    title: "Scout defense",
    body: "The defense lines up the way the scout team sees it. Drag each defender to where they actually aligned on film.",
  },
  {
    icon: Users,
    title: "11-on-11 or 7-on-7",
    body: "Switch periods in one tap. Linemen drop out for 7-on-7, and each period lists the right plays.",
  },
  {
    icon: PenLine,
    title: "Edit and draw",
    body: "Fix a formation, set a route for any letter, or sketch with Apple Pencil. Changes save to the card.",
  },
  {
    icon: Layers,
    title: "Several films, one script",
    body: "Drop a CSV per game and filter by film. Play numbers never collide.",
  },
  {
    icon: Printer,
    title: "Print 2 or 4 up",
    body: "Letter-size sheets in black on white. Print them or save a PDF.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-primary focus:px-5 focus:py-3 focus:font-semibold focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <header className="site-header sticky top-0 z-30 border-b border-white/10 bg-background/70 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between px-6">
          <Link href="/" aria-label="ScoutCard AI home" className="flex min-h-11 items-center rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60">
            <BrandMark />
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
            <a href="#features" className="nav-link hidden sm:inline-flex">
              Features
            </a>
            <a href="#how" className="nav-link hidden sm:inline-flex">
              How it works
            </a>
            <Link
              href="/script"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/10 px-5 text-[15px] font-semibold transition-[transform,background-color] duration-100 outline-none hover:bg-white/15 focus-visible:ring-[3px] focus-visible:ring-ring/60 active:scale-[0.97] motion-reduce:active:scale-100"
            >
              Open script
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        {/* Hero */}
        <section className="mx-auto flex max-w-[880px] flex-col items-center gap-6 px-6 pt-14 text-center sm:pt-24">
          <p className="text-[15px] font-semibold text-primary">Scout team cards from your Hudl breakdown</p>
          <h1 className="text-balance text-[44px] leading-[1.03] font-bold tracking-[-0.03em] sm:text-[76px] sm:leading-[1.01]">
            Stop drawing cards.
            <br />
            <span className="text-muted-foreground">Start repping looks.</span>
          </h1>
          <p className="max-w-[620px] text-pretty text-[19px] leading-[1.45] text-muted-foreground sm:text-[21px]">
            Drop in this week’s Hudl CSV. Every play becomes a clean scout team card, ready to flip through on
            the iPad at practice or print 2 or 4 to a page.
          </p>
          <div className="mt-4 w-full">
            <LandingUpload />
          </div>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="size-4 shrink-0" aria-hidden="true" />
            Parsed on this device. Your film breakdown never leaves it.
          </p>
        </section>

        {/* One row in, two cards out */}
        <section
          aria-labelledby="showcase-title"
          className="mx-auto mt-24 max-w-[1120px] px-6 sm:mt-32"
        >
          <div className="reveal mx-auto flex max-w-[680px] flex-col items-center gap-4 text-center">
            <h2 id="showcase-title" className="section-title">
              One Hudl row. Two cards.
            </h2>
            <p className="text-[19px] leading-snug text-muted-foreground">
              The scout offense gets the routes and blocking. The scout defense gets the alignment. Both come
              from the same line of your export.
            </p>
          </div>

          <figure className="reveal mx-auto mt-10 max-w-[760px] overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <figcaption className="mb-3 text-[13px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
              Row 7 of the export
            </figcaption>
            <dl className="flex gap-6 font-mono text-[14px] whitespace-nowrap">
              {Object.entries(SAMPLE_ROW).map(([key, value]) => (
                <div key={key} className="flex flex-col gap-1">
                  <dt className="text-[12px] text-muted-foreground">{key}</dt>
                  <dd className="font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </figure>

          <div className="relative mt-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 -top-10 -bottom-10 -z-10 bg-[radial-gradient(50%_50%_at_50%_50%,rgba(255,138,61,0.14),transparent_70%)]"
            />
            <div className="grid gap-8 lg:grid-cols-2">
              {(
                [
                  { unit: "offense", label: "Scout offense" },
                  { unit: "defense", label: "Scout defense" },
                ] as const
              ).map(({ unit, label }) => (
                <figure key={unit} className="reveal flex flex-col gap-3">
                  <div className="shadow-[0_30px_80px_-24px_rgba(0,0,0,0.75)]">
                    <ScoutCard card={PREVIEW_CARD} unit={unit} />
                  </div>
                  <figcaption className="text-center text-[15px] font-semibold text-muted-foreground">
                    {label}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section
          id="features"
          aria-labelledby="features-title"
          className="mx-auto mt-28 max-w-[1120px] px-6 sm:mt-40"
        >
          <h2 id="features-title" className="section-title reveal text-center">
            Built for practice, not for the office.
          </h2>
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li
                key={title}
                className="reveal flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/[0.04] p-6"
              >
                <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/15">
                  <Icon className="size-5 text-primary" aria-hidden="true" />
                </span>
                <h3 className="text-[20px] font-semibold tracking-[-0.01em]">{title}</h3>
                <p className="text-[16px] leading-snug text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Offline + privacy */}
        <section aria-labelledby="field-title" className="mx-auto mt-28 max-w-[1120px] px-6 sm:mt-40">
          <div className="reveal grid gap-8 rounded-[32px] border border-white/10 bg-white/[0.04] p-8 sm:p-12 lg:grid-cols-[1.2fr_1fr] lg:items-center">
            <div className="flex flex-col gap-4">
              <h2 id="field-title" className="section-title">
                Works where the signal doesn’t.
              </h2>
              <p className="text-[19px] leading-snug text-muted-foreground">
                Add ScoutCard to your iPad Home Screen once. After that it opens full screen and runs with no
                connection, and your script is still there after a restart.
              </p>
            </div>
            <ul className="flex flex-col gap-4">
              <li className="flex items-start gap-3">
                <WifiOff className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="text-[17px] leading-snug">Offline on the field, no Wi-Fi needed.</span>
              </li>
              <li className="flex items-start gap-3">
                <Lock className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="text-[17px] leading-snug">
                  The CSV is read in the browser. It’s never uploaded.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Smartphone className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="text-[17px] leading-snug">Big touch targets, built for sunlight.</span>
              </li>
            </ul>
          </div>
        </section>

        {/* Steps */}
        <section id="how" aria-labelledby="how-title" className="mx-auto mt-28 max-w-[1120px] px-6 sm:mt-40">
          <h2 id="how-title" className="section-title reveal text-center">
            Three steps. No drawing.
          </h2>
          <ol className="mt-12 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="reveal flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/[0.04] p-6"
              >
                <span
                  aria-hidden="true"
                  className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-[17px] font-semibold text-primary"
                >
                  {i + 1}
                </span>
                <h3 className="text-[20px] font-semibold tracking-[-0.01em]">{step.title}</h3>
                <p className="text-[16px] leading-snug text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Closing CTA */}
        <section aria-labelledby="cta-title" className="mx-auto mt-28 max-w-[880px] px-6 pb-24 text-center sm:mt-40">
          <div className="reveal flex flex-col items-center gap-5">
            <h2 id="cta-title" className="section-title">
              Have this week’s breakdown?
            </h2>
            <p className="max-w-[520px] text-[19px] leading-snug text-muted-foreground">
              Your cards are a CSV away. No Hudl file handy? Try the five-play demo first.
            </p>
            <a
              href="#main"
              className="inline-flex h-[52px] items-center gap-2 rounded-full bg-primary px-8 text-[17px] font-semibold text-primary-foreground transition-[transform,opacity] duration-100 outline-none hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] motion-reduce:active:scale-100"
            >
              Upload a CSV
              <ArrowRight className="size-5" aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 px-6 py-8">
        <div className="mx-auto flex max-w-[1120px] flex-col items-center justify-between gap-3 text-sm text-muted-foreground sm:flex-row">
          <BrandMark />
          <p>Made for high school football staffs. Hudl is a trademark of its owner; ScoutCard AI isn’t affiliated.</p>
        </div>
      </footer>
    </div>
  );
}

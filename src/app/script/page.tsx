"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FilePlus2,
  Grid2x2,
  Move,
  RotateCcw,
  Pencil,
  PenLine,
  Undo2,
  Eraser,
  RectangleVertical,
  Shield,
  Sparkles,
  Upload,
  Sun,
} from "lucide-react";
import { AppGate } from "@/components/AppGate";
import { BrandMark } from "@/components/BrandMark";
import { FilterGroup, type FilterOption } from "@/components/FilterBar";
import { EditPlayDialog } from "@/components/EditPlayDialog";
import { GenerateCardDialog } from "@/components/GenerateCardDialog";
import { SafetyDepthControl } from "@/components/SafetyDepthControl";
import { SecondaryDialog } from "@/components/SecondaryDialog";
import { ImportNotice } from "@/components/ImportNotice";
import { PrintGrid } from "@/components/PrintGrid";
import { ScoutCard, SCOUT_CARD_ASPECT } from "@/components/ScoutCard";
import { computeTendencies } from "@/lib/tendencies";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MOCK_HUDL_CSV, DEMO_FILE_NAME } from "@/lib/demoScript";
import {
  buildDiagram,
  FORMATION_LABELS,
  fromCardPoint,
  inPeriod,
  type Period,
  type ScoutUnit,
} from "@/lib/formations";
import { coverageStyleFor, safetyDepthFor, safetyY, type DefensiveAlignment } from "@/lib/defensiveAligner";
import {
  parseHudlCsvText,
  type FormationKey,
  type HudlPlayCard,
  type InkStroke,
} from "@/lib/hudlParser";
import { importFilms } from "@/lib/importFilms";
import {
  isRepCard,
  loadPlan,
  periodRepCards,
  periodScoutOCards,
  type PracticeDay,
  type PracticePlan,
} from "@/lib/practicePlan";
import { applyReview, reviewRows, type ReviewResult } from "@/lib/importReview";
import { SyncBadge } from "@/components/CloudSync";
import { ReviewBar, ReviewSummaryDialog } from "@/components/ReviewBar";
import { loadScript, saveScript, storeScript, type ScriptSlot, type StoredScript } from "@/lib/scriptStore";
import { nextUnchecked, reviewStatus } from "@/lib/review";
import { useRemoteApplied } from "@/lib/useRemoteApplied";
import { cn } from "@/lib/utils";

type View = "field" | "print";
type Mode = Period;
type DownFilter = "all" | 1 | 2 | 3 | 4;
type FormationFilter = "all" | FormationKey;

const DOWN_LABELS: Record<Exclude<DownFilter, "all">, string> = {
  1: "1st",
  2: "2nd",
  3: "3rd",
  4: "4th",
};
const FORMATION_ORDER: FormationKey[] = [
  "spread",
  "trips",
  "i-form",
  "pro",
  "split-pro",
  "double-eagle",
  "unknown",
];
const SWIPE_THRESHOLD = 60;

/** Pencil colors: dark enough to read on the white field in sunlight. */
const INK_COLORS = [
  { value: "#111111", label: "Black" },
  { value: "#dc2626", label: "Red" },
  { value: "#2563eb", label: "Blue" },
  { value: "#16a34a", label: "Green" },
];

const MODES: { value: Mode; label: string; short: string }[] = [
  { value: "all", label: "ALL PLAYS", short: "ALL" },
  { value: "7v7", label: "7v7 / PASS SKEL", short: "7v7" },
  { value: "team", label: "TEAM (11v11)", short: "TEAM" },
];

const UNITS: { value: ScoutUnit; label: string; short: string }[] = [
  { value: "offense", label: "SCOUT OFFENSE", short: "SCOUT O" },
  { value: "defense", label: "SCOUT DEFENSE", short: "SCOUT D" },
];

export default function ScriptPage() {
  // The 5-play demo is public; anything uploaded needs access (AppGate).
  const [demoLoaded, setDemoLoaded] = useState(false);
  useEffect(() => setDemoLoaded(isDemoScript(loadScript())), []);
  const startDemo = () => {
    saveScript(DEMO_FILE_NAME, parseHudlCsvText(MOCK_HUDL_CSV));
    setDemoLoaded(true);
  };
  return (
    <AppGate
      whenLocked={demoLoaded ? <ScriptApp demoMode /> : undefined}
      lockedActions={
        <Button size="xl" variant="outline" onClick={startDemo}>
          Try the 5-play demo
        </Button>
      }
    >
      <ScriptApp />
    </AppGate>
  );
}

/** The script is just the public demo (nothing uploaded). */
function isDemoScript(script: StoredScript | null): boolean {
  return Boolean(script && script.films.length === 1 && script.films[0] === DEMO_FILE_NAME);
}


const SUNLIGHT_KEY = "scoutcard:sunlight:v1";
/**
 * `demoMode`: someone without access looking at the public demo. The five
 * demo cards work (swipe, Scout O/D, print, draw), but nothing new comes in:
 * no uploads, AI cards, playsheet, or editing plays.
 */
function ScriptApp({ demoMode = false }: { demoMode?: boolean }) {
  const router = useRouter();
  // undefined while reading localStorage, null when nothing is loaded.
  const [script, setScript] = useState<StoredScript | null | undefined>(undefined);
  // /script?playbook=1 studies the staff's own playbook (its own storage slot), not the scout script.
  const [slot, setSlot] = useState<ScriptSlot>("script");
  const isPlaybook = slot === "playbook";
  const [view, setView] = useState<View>("field");
  const [modeChoice, setMode] = useState<Mode>("all");
  const [unitChoice, setUnit] = useState<ScoutUnit>("offense");
  // Practice mode (/script?practice=<day>&period=<n>): the day's playsheet
  // decides the unit, period type and cards instead of the toggles.
  const [practice, setPractice] = useState<{
    plan: PracticePlan;
    day: PracticeDay;
  } | null>(null);
  const [periodIndex, setPeriodIndex] = useState(0);
  const [down, setDown] = useState<DownFilter>("all");
  const [formation, setFormation] = useState<FormationFilter>("all");
  const [film, setFilm] = useState<string>("all");
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  // Scout O: every route's break points become draggable.
  const [adjustingArrows, setAdjustingArrows] = useState(false);
  // Review mode: go through the plays, confirm or fix each tag, keep score (src/lib/review.ts).
  const [reviewing, setReviewing] = useState(false);
  const [onlyUnchecked, setOnlyUnchecked] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Sunlight mode (black and white, thick lines), remembered on this iPad.
  const [sunlight, setSunlight] = useState(false);
  useEffect(() => {
    try {
      setSunlight(window.localStorage.getItem(SUNLIGHT_KEY) === "1");
    } catch {
      // Private mode: stays off.
    }
  }, []);
  const [drawing, setDrawing] = useState(false);
  const [inkColor, setInkColor] = useState(INK_COLORS[0].value);
  // Card id + unit waiting on a second tap of Clear.
  const [clearArmed, setClearArmed] = useState<string | null>(null);
  const [notice, setNotice] = useState({
    heading: "",
    detail: "",
    warnings: [] as string[],
    trigger: 0,
  });
  const addFilmInput = useRef<HTMLInputElement>(null);
  const reviewPending = useRef(false);
  const scriptRef = useRef<StoredScript | null | undefined>(undefined);
  scriptRef.current = script;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const which: ScriptSlot = params.get("playbook") === "1" ? "playbook" : "script";
    setSlot(which);
    setScript(loadScript(which));
    // A fresh import: let the AI read what the rules couldn't place (below).
    if (params.get("loaded") === "1") reviewPending.current = true;
    const dayId = which === "script" ? params.get("practice") : null;
    if (!dayId) return;
    const plan = loadPlan();
    const day = plan.days.find((d) => d.id === dayId);
    if (!day || day.periods.length === 0) return;
    setPractice({ plan, day });
    const at = Number.parseInt(params.get("period") ?? "0", 10);
    setPeriodIndex(Number.isFinite(at) ? Math.min(Math.max(at, 0), day.periods.length - 1) : 0);
  }, []);

  // The staff's copy just landed on this device (another coach saved, or a first sign-in).
  useRemoteApplied(["script", "playbook", "practice"], (applied) => {
    if (applied === "practice") {
      const dayId = new URLSearchParams(window.location.search).get("practice");
      const plan = loadPlan();
      const day = plan.days.find((d) => d.id === dayId);
      if (day && day.periods.length > 0) setPractice({ plan, day });
    } else if (applied === slot) {
      setScript(loadScript(applied));
    }
  });

  const cards = useMemo(() => script?.cards ?? [], [script]);
  const practicePeriod = practice?.day.periods[periodIndex];
  // Our offense's period is the scout defense's; our defense's is the scout offense's.
  const unit: ScoutUnit = practicePeriod
    ? practicePeriod.side === "offense"
      ? "defense"
      : "offense"
    : unitChoice;
  const mode: Mode = practicePeriod ? practicePeriod.kind : modeChoice;
  const periodCards = useMemo(() => {
    if (!practice) return [];
    return practice.day.periods.map((p) =>
      p.side === "offense"
        ? periodRepCards(p, cards, practice.plan.formationAliases)
        : periodScoutOCards(p, cards),
    );
  }, [practice, cards]);
  // Whole-script tendencies, not the currently filtered view -- "how often
  // does this team run Trips" means the whole game, not just this filter.
  const tendencies = useMemo(() => computeTendencies(cards), [cards]);
  const multiFilm = (script?.films.length ?? 0) > 1;
  const modeCards = useMemo(
    () =>
      practicePeriod
        ? (periodCards[periodIndex] ?? [])
        : cards.filter((c) => inPeriod(c, mode, unit) && (film === "all" || c.source === film)),
    [cards, mode, unit, film, practicePeriod, periodCards, periodIndex],
  );
  const dbAlignments = script?.dbAlignments;
  const filtered = useMemo(() => {
    const list = practicePeriod
      ? modeCards
      : modeCards.filter(
          (c) =>
            (down === "all" || c.down === down) &&
            (formation === "all" || c.formationKey === formation) &&
            !(reviewing && onlyUnchecked && c.reviewedAt),
        );
    // Scout D: the staff's secondary for each card's formation (src/lib/secondary.ts).
    if (unit !== "defense" || !dbAlignments) return list;
    return list.map((c) => (dbAlignments[c.formationKey] ? { ...c, secondary: dbAlignments[c.formationKey] } : c));
  }, [modeCards, down, formation, practicePeriod, unit, dbAlignments, reviewing, onlyUnchecked]);
  const cardMode = mode === "7v7" ? "7v7" : "team";

  const downOptions: FilterOption<DownFilter>[] = [
    { value: "all", label: "All", count: modeCards.length },
    ...([1, 2, 3, 4] as const).map((d) => ({
      value: d,
      label: DOWN_LABELS[d],
      count: modeCards.filter((c) => c.down === d).length,
    })),
  ];
  const formationOptions: FilterOption<FormationFilter>[] = [
    { value: "all", label: "All", count: modeCards.length },
    ...FORMATION_ORDER.map((key) => ({
      value: key,
      label: FORMATION_LABELS[key],
      count: modeCards.filter((c) => c.formationKey === key).length,
    })).filter((o) => o.count > 0),
  ];

  const filmOptions: FilterOption<string>[] = [
    {
      value: "all",
      label: "All",
      count: cards.filter((c) => inPeriod(c, mode, unit)).length,
    },
    ...(script?.films ?? []).map((name) => ({
      value: name,
      label: name.replace(/\.(csv|xlsx)$/i, ""),
      count: cards.filter((c) => c.source === name && inPeriod(c, mode, unit)).length,
    })),
  ];

  const position = Math.min(index, Math.max(filtered.length - 1, 0));
  const current: HudlPlayCard | undefined = filtered[position];
  const canPrev = position > 0;
  const canNext = position < filtered.length - 1;
  const periodCount = practice?.day.periods.length ?? 0;
  const hasPrevPeriod = Boolean(practicePeriod) && periodIndex > 0;
  const hasNextPeriod = Boolean(practicePeriod) && periodIndex < periodCount - 1;
  // Playsheet cards aren't in the saved script, so there's nothing to edit or draw on.
  const editable = Boolean(current) && !isRepCard(current!);

  const goToPeriod = useCallback(
    (at: number, toEnd = false) => {
      if (!practice) return;
      setPeriodIndex(at);
      setIndex(toEnd ? Math.max((periodCards[at]?.length ?? 1) - 1, 0) : 0);
      setDrawing(false);
      setAdjusting(false);
      setAdjustingArrows(false);
      const q = new URLSearchParams({
        practice: practice.day.id,
        period: String(at),
      });
      window.history.replaceState(null, "", `/script?${q}`);
    },
    [practice, periodCards],
  );

  const prev = useCallback(() => {
    if (!canPrev && hasPrevPeriod) return goToPeriod(periodIndex - 1, true);
    setIndex((i) => Math.max(0, Math.min(i, filtered.length - 1) - 1));
  }, [filtered.length, canPrev, hasPrevPeriod, goToPeriod, periodIndex]);
  const next = useCallback(() => {
    if (!canNext && hasNextPeriod) return goToPeriod(periodIndex + 1);
    setIndex((i) => Math.min(filtered.length - 1, Math.min(i, filtered.length - 1) + 1));
  }, [filtered.length, canNext, hasNextPeriod, goToPeriod, periodIndex]);

  useEffect(() => {
    if (view !== "field") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight" || e.key === " ") {
        if (e.target instanceof HTMLButtonElement && e.key === " ") return;
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, prev, next]);

  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const railRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    railRef.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [position, filtered]);

  const setFilter =
    <T,>(setter: (v: T) => void) =>
    (value: T) => {
      setter(value);
      setIndex(0);
    };

  const saveCards = (nextCards: HudlPlayCard[]) => {
    if (!script) return;
    // `secondary` is attached for display only; the table lives on the script.
    const stored = nextCards.map((c) => {
      const copy = { ...c };
      delete copy.secondary;
      return copy;
    });
    setScript(storeScript({ ...script, cards: stored }, slot));
  };

  /** Review mode: checks (or un-checks) a play, keeping what the file said next to what it reads now. */
  const markChecked = (id: string, on: boolean) =>
    saveCards(
      cards.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c };
        if (on) next.reviewedAt = new Date().toISOString();
        else delete next.reviewedAt;
        return next;
      }),
    );
  /** After a play is checked: on to the next one still unchecked, or the scorecard when none are left. */
  const afterChecked = (id: string) => {
    const left = cards.filter((c) => !c.reviewedAt && c.id !== id);
    if (left.length === 0) {
      setSummaryOpen(true);
      return;
    }
    if (onlyUnchecked) return; // the checked play leaves the list, so the next one is already here
    const next = nextUnchecked(
      filtered.map((c) => (c.id === id ? { ...c, reviewedAt: "now" } : c)),
      position,
    );
    if (next !== null) setIndex(next);
  };

  /**
   * The play's safety depth / slot play (Scout D toolbar). A safety a coach
   * already dragged keeps his spot across and moves to the new depth.
   */
  const setDefenseAlignment = (next: DefensiveAlignment | undefined) => {
    if (!current) return;
    saveCards(
      cards.map((c) => {
        if (c.id !== current.id) return c;
        const overrides = { ...c.defenseOverrides };
        for (const id of Object.keys(overrides)) {
          const depth = safetyDepthFor(next, id.replace(/\d+$/, ""));
          if (depth != null) overrides[id] = { ...overrides[id], y: safetyY(depth) };
        }
        return {
          ...c,
          defenseAlignment: next,
          defenseOverrides: Object.keys(overrides).length ? overrides : undefined,
          edited: true,
        };
      }),
    );
  };

  /** Where the current Scout D card draws each safety, in yards (what the depth boxes show on auto). */
  const drawnSafetyDepths = useMemo(() => {
    const none = { FS: 12, SS: 12 };
    if (!current || unit !== "defense") return none;
    const d = buildDiagram({ ...current, defenseAlignment: undefined }, cardMode, "defense");
    const yards = (label: string, fallback: number) => {
      const p = d.defense.find((x) => x.label === label);
      return p ? Math.round(((140 - fromCardPoint(d, p).y) / 7) * 2) / 2 : fallback;
    };
    return { FS: yards("FS", 12), SS: yards("SS", 12) };
  }, [current, unit, cardMode]);

  /** Replaces the current card's pencil strokes for the unit on screen. */
  const setStrokes = (change: (strokes: InkStroke[]) => InkStroke[]) => {
    if (!current) return;
    saveCards(
      cards.map((c) =>
        c.id === current.id
          ? {
              ...c,
              drawings: {
                ...c.drawings,
                [unit]: change(c.drawings?.[unit] ?? []),
              },
            }
          : c,
      ),
    );
  };
  const strokeCount = current?.drawings?.[unit]?.length ?? 0;
  const clearKey = current ? `${current.id}:${unit}` : null;
  const confirmClear = clearArmed !== null && clearArmed === clearKey;
  const setConfirmClear = (armed: boolean) => setClearArmed(armed ? clearKey : null);

  /**
   * AI review of an import (src/lib/importReview.ts): plays the rules couldn't
   * place go to /api/review-import once, and the answers become card hints.
   * Silent when the AI isn't available here (no access, offline); the plays
   * already load exactly as the file reads.
   */
  const reviewImport = useCallback(async (base: StoredScript) => {
    const rows = reviewRows(base.cards);
    if (rows.length === 0) return;
    let payload: { reviewedIds?: string[]; results?: ReviewResult[]; error?: string; model?: string };
    let status = 0;
    try {
      const res = await fetch("/api/review-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      status = res.status;
      // A timeout or server crash answers with a page, not JSON.
      payload = await res.json().catch(() => ({
        error: status === 504 ? "The AI took too long." : `The server answered ${status}.`,
      }));
    } catch {
      return; // Offline: the plays load exactly as the file reads.
    }
    if (status === 401 || status === 402 || status === 403) return;
    if (status !== 200 || !payload.reviewedIds || !payload.results) {
      setNotice((n) => ({
        heading: "AI review didn't run",
        detail: `${payload.error ?? "Try adding the film again later."} Every play still loads exactly as the file reads.`,
        warnings: [],
        trigger: n.trigger + 1,
      }));
      return;
    }
    const latest = scriptRef.current ?? base;
    const { cards: reviewed, filled } = applyReview(latest.cards, payload.reviewedIds, payload.results);
    setScript(storeScript({ ...latest, cards: reviewed }, slot));
    if (filled > 0) {
      setNotice((n) => ({
        heading: `AI filled in ${filled} ${filled === 1 ? "play" : "plays"}`,
        detail:
          `Formations, fronts or run/pass the file didn't make clear. They're marked AI in the play list; check them and fix any with Edit play.${payload.model ? ` Read by ${payload.model}.` : ""}`,
        warnings: [],
        trigger: n.trigger + 1,
      }));
    }
  }, [slot]);
  useEffect(() => {
    if (script && reviewPending.current) {
      reviewPending.current = false;
      void reviewImport(script);
    }
  }, [script, reviewImport]);

  const addFilms = async (files: File[]) => {
    if (!script || files.length === 0) return;
    const imported = await importFilms(files);
    const heading = imported.cards.length
      ? `Added ${imported.cards.length} ${imported.cards.length === 1 ? "play" : "plays"}`
      : "No plays added";
    if (imported.cards.length) {
      const next = storeScript(
        {
          ...script,
          films: [...script.films, ...imported.films],
          cards: [...script.cards, ...imported.cards],
          warnings: [...script.warnings, ...imported.warnings],
        },
        slot,
      );
      setScript(next);
      reviewPending.current = true;
    }
    setNotice((n) => ({
      heading,
      detail: files.map((f) => f.name).join(", "),
      warnings: imported.warnings,
      trigger: n.trigger + 1,
    }));
  };

  const loadDemo = () => {
    setScript(saveScript(DEMO_FILE_NAME, parseHudlCsvText(MOCK_HUDL_CSV)));
    setIndex(0);
  };

  /** A card from the AI dialog: added to the end of the script (or starts one) and shown. */
  const addGenerated = (card: HudlPlayCard) => {
    const existing = script?.cards ?? [];
    const playNumber = Math.max(0, ...existing.map((c) => c.playNumber)) + 1;
    const added = { ...card, playNumber, rowIndex: playNumber - 1 };
    setScript(
      storeScript(
        script
          ? { ...script, cards: [...existing, added] }
          : { fileName: "", films: [], savedAt: "", cards: [added], warnings: [] },
        slot,
      ),
    );
    // Show it: every play, Scout O, no filters, so the new card is last.
    setMode("all");
    setUnit("offense");
    setDown("all");
    setFormation("all");
    setFilm("all");
    setIndex(existing.length);
    setGenerating(false);
    setNotice((n) => ({
      heading: "Added an AI card",
      detail: "Drag a route's break points to fix it. On Scout D, Adjust X's moves the defense.",
      warnings: [],
      trigger: n.trigger + 1,
    }));
  };
  const generateDialog = (
    <GenerateCardDialog open={generating} onOpenChange={setGenerating} onCreate={addGenerated} />
  );

  if (script === undefined) return <div className="min-h-dvh" />;

  if (script === null || cards.length === 0) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
        <BrandMark />
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-4xl font-bold">
            {isPlaybook ? "No playbook uploaded yet" : "No scout script loaded"}
          </h1>
          <p className="text-lg text-muted-foreground">
            {isPlaybook
              ? "Upload your own plays, a spreadsheet or pasted rows, and study them here."
              : "Upload this week's Hudl breakdown, or try the 5-play demo."}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button size="xl" onClick={() => router.push(isPlaybook ? "/#playbook" : "/")}>
            <Upload aria-hidden="true" />
            {isPlaybook ? "Upload your playbook" : "Upload a Hudl CSV"}
          </Button>
          {!isPlaybook && (
            <Button size="xl" variant="outline" onClick={loadDemo}>
              Load demo script
            </Button>
          )}
          <Button size="xl" variant="outline" onClick={() => setGenerating(true)}>
            <Sparkles aria-hidden="true" />
            Draw a play with AI
          </Button>
        </div>
        {generateDialog}
      </main>
    );
  }

  return (
    <Tabs
      value={view}
      onValueChange={(v) => setView(v as View)}
      className={cn("gap-0", view === "field" ? "h-dvh overflow-hidden" : "min-h-dvh")}
    >
      <header className="no-print flex h-16 shrink-0 items-center gap-4 border-b px-4 sm:px-6">
        <Button asChild variant="outline" size="icon" className="border">
          <Link
            href={practice ? `/practice?day=${practice.day.id}` : isPlaybook ? "/#playbook" : "/"}
            aria-label={practice ? "Back to the playsheet" : "Back to upload"}
          >
            <ChevronLeft className="size-5" />
          </Link>
        </Button>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="text-xs font-bold tracking-[0.14em] text-primary">
              {practice ? `PRACTICE · ${practice.day.name.toUpperCase()}` : isPlaybook ? "OUR PLAYBOOK" : "SCOUT SCRIPT"}
            </span>
            <SyncBadge className="h-6" />
          </span>
          <span className="font-display truncate text-2xl leading-[1.05] font-bold">
            {practicePeriod
              ? `${practicePeriod.name} · ${practicePeriod.kind === "7v7" ? "7v7" : "Team"} · ${
                  unit === "defense" ? "Scout D" : "Scout O"
                }`
              : `${script.fileName} · ${cards.length} plays`}
          </span>
        </div>
        {!practicePeriod && (
          <>
            <div
              role="group"
              aria-label="Scout team"
              className="flex shrink-0 rounded-xl border bg-secondary p-1"
            >
              {UNITS.map((u) => {
                const selected = unit === u.value;
                return (
                  <button
                    key={u.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setUnit(u.value);
                      setIndex(0);
                    }}
                    className={cn(
                      "flex h-11 items-center rounded-[9px] px-3 text-sm font-bold whitespace-nowrap transition-colors",
                      "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                      selected
                        ? "bg-foreground text-background"
                        : "text-foreground hover:bg-accent",
                    )}
                  >
                    <span className="hidden xl:inline">{u.label}</span>
                    <span className="xl:hidden">{u.short}</span>
                  </button>
                );
              })}
            </div>
            <div
              role="group"
              aria-label="Practice period"
              className="flex shrink-0 rounded-xl border bg-secondary p-1"
            >
              {MODES.map((m) => {
                const count = cards.filter((c) => inPeriod(c, m.value, unit)).length;
                const selected = mode === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setMode(m.value);
                      setIndex(0);
                    }}
                    className={cn(
                      "flex h-11 items-center gap-1.5 rounded-[9px] px-3 text-sm font-bold whitespace-nowrap transition-colors",
                      "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground hover:bg-accent",
                    )}
                  >
                    <span className="hidden xl:inline">{m.label}</span>
                    <span className="xl:hidden">{m.short}</span>
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        selected ? "text-primary-foreground/75" : "text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        <button
          type="button"
          aria-pressed={sunlight}
          onClick={() => {
            const next = !sunlight;
            setSunlight(next);
            try {
              window.localStorage.setItem(SUNLIGHT_KEY, next ? "1" : "0");
            } catch {
              // Private mode: it just won't be remembered.
            }
          }}
          title="Sunlight mode: black and white, thick lines"
          className={cn(
            "flex h-[54px] shrink-0 items-center gap-2 rounded-xl border px-3 text-base font-bold transition-colors",
            "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            sunlight ? "border-foreground bg-foreground text-background" : "bg-secondary hover:bg-accent",
          )}
        >
          <Sun className="size-[18px]" aria-hidden="true" />
          <span className="hidden lg:inline">Sunlight</span>
        </button>
        <TabsList className="h-[54px] rounded-xl border bg-secondary p-1">
          <TabsTrigger
            value="field"
            className="h-11 rounded-[9px] px-3 text-base font-bold data-[state=active]:bg-foreground data-[state=active]:text-background sm:px-4"
          >
            <RectangleVertical className="size-[18px]" aria-hidden="true" />
            <span className="hidden sm:inline">Field View</span>
            <span className="sm:hidden">Field</span>
          </TabsTrigger>
          <TabsTrigger
            value="print"
            className="h-11 rounded-[9px] px-3 text-base font-bold data-[state=active]:bg-foreground data-[state=active]:text-background sm:px-4"
          >
            <Grid2x2 className="size-[18px]" aria-hidden="true" />
            <span className="hidden sm:inline">Print Grid</span>
            <span className="sm:hidden">Print</span>
          </TabsTrigger>
        </TabsList>
      </header>

      <div className="no-print flex h-16 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
        {drawing && view === "field" ? (
          <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto">
            <span className="shrink-0 text-xs font-bold tracking-[0.12em] text-muted-foreground">
              PENCIL
            </span>
            <div role="group" aria-label="Pencil color" className="flex shrink-0 gap-1.5">
              {INK_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  aria-label={color.label}
                  aria-pressed={inkColor === color.value}
                  onClick={() => setInkColor(color.value)}
                  className={cn(
                    "flex size-11 items-center justify-center rounded-[10px] border-2 transition-colors",
                    "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                    inkColor === color.value
                      ? "border-foreground"
                      : "border-transparent hover:border-border",
                  )}
                >
                  <span
                    className="size-7 rounded-full border-2 border-white/80"
                    style={{ backgroundColor: color.value }}
                  />
                </button>
              ))}
            </div>
            <span className="h-7 w-px shrink-0 bg-border" aria-hidden="true" />
            <Button
              size="lg"
              variant="outline"
              disabled={strokeCount === 0}
              onClick={() => setStrokes((s) => s.slice(0, -1))}
            >
              <Undo2 aria-hidden="true" />
              Undo
            </Button>
            <Button
              size="lg"
              variant={confirmClear ? "destructive" : "outline"}
              disabled={strokeCount === 0}
              onClick={() => {
                if (!confirmClear) return setConfirmClear(true);
                setStrokes(() => []);
                setConfirmClear(false);
              }}
            >
              <Eraser aria-hidden="true" />
              {confirmClear ? "Tap again to clear" : "Clear"}
            </Button>
            <p className="hidden shrink-0 text-sm text-muted-foreground xl:block">
              Draw on the field with a Pencil or finger. Swiping is paused.
            </p>
          </div>
        ) : practice ? (
          <div
            role="group"
            aria-label="Practice period"
            className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
          >
            <span className="mr-1.5 shrink-0 text-xs font-bold tracking-[0.12em] text-muted-foreground">
              PERIOD
            </span>
            {practice.day.periods.map((p, i) => {
              const selected = i === periodIndex;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => goToPeriod(i)}
                  className={cn(
                    "flex h-11 shrink-0 flex-col items-start justify-center rounded-[10px] border px-3 text-left leading-tight transition-colors",
                    "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-accent",
                  )}
                >
                  <span className="text-sm font-bold whitespace-nowrap">{p.name}</span>
                  <span
                    className={cn(
                      "text-[11px] font-semibold whitespace-nowrap",
                      selected ? "text-primary-foreground/75" : "text-muted-foreground",
                    )}
                  >
                    {p.kind === "7v7" ? "7v7" : "Team"} ·{" "}
                    {p.side === "offense" ? "Scout D" : "Scout O"} · {periodCards[i]?.length ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-5 overflow-x-auto">
            <FilterGroup
              label="DOWN"
              options={downOptions}
              value={down}
              onChange={setFilter(setDown)}
            />
            <span className="h-7 w-px shrink-0 bg-border" aria-hidden="true" />
            <FilterGroup
              label="FORMATION"
              options={formationOptions}
              value={formation}
              onChange={setFilter(setFormation)}
            />
            {multiFilm && (
              <>
                <span className="h-7 w-px shrink-0 bg-border" aria-hidden="true" />
                <FilterGroup
                  label="FILM"
                  options={filmOptions}
                  value={film}
                  onChange={setFilter(setFilm)}
                />
              </>
            )}
          </div>
        )}
        <div className="flex shrink-0 gap-2 border-l pl-3">
          {view === "field" && (
            <Button
              size="lg"
              variant={drawing ? "default" : "outline"}
              aria-pressed={drawing}
              onClick={() => {
                setDrawing((d) => !d);
                setAdjusting(false);
                setAdjustingArrows(false);
                setConfirmClear(false);
              }}
              disabled={!editable}
            >
              <PenLine aria-hidden="true" />
              {drawing ? "Done" : "Draw"}
            </Button>
          )}
          {view === "field" && !drawing && !demoMode && !practice && (
            <Button
              size="lg"
              variant={reviewing ? "default" : "outline"}
              aria-pressed={reviewing}
              onClick={() => {
                setReviewing((r) => !r);
                setOnlyUnchecked(false);
              }}
              disabled={!editable}
            >
              <ClipboardCheck aria-hidden="true" />
              {reviewing ? "Done" : "Review"}
            </Button>
          )}
          {unit === "offense" && view === "field" && !drawing && !demoMode && (
            <>
              <Button
                size="lg"
                variant={adjustingArrows ? "default" : "outline"}
                aria-pressed={adjustingArrows}
                onClick={() => setAdjustingArrows((a) => !a)}
                disabled={!editable}
              >
                <Move aria-hidden="true" />
                {adjustingArrows ? "Done" : "Adjust arrows"}
              </Button>
              {adjustingArrows && current?.routeOverrides && Object.values(current.routeOverrides).some((o) => o.source === "coach") && (
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() =>
                    saveCards(
                      cards.map((c) => {
                        if (c.id !== current.id || !c.routeOverrides) return c;
                        // Back to the play call's own arrow; a tag the coach wrote stays.
                        const kept = Object.fromEntries(
                          Object.entries(c.routeOverrides).flatMap(([letter, o]) => {
                            if (o.source !== "coach" || !o.path) return [[letter, o]];
                            return o.tag ? [[letter, { tag: o.tag }]] : [];
                          }),
                        );
                        return { ...c, routeOverrides: Object.keys(kept).length ? kept : undefined };
                      }),
                    )
                  }
                >
                  <RotateCcw aria-hidden="true" />
                  Reset arrows
                </Button>
              )}
            </>
          )}
          {unit === "defense" && view === "field" && !drawing && !demoMode && (
            <Button size="lg" variant="outline" onClick={() => setSecondaryOpen(true)}>
              <Shield aria-hidden="true" />
              Secondary
            </Button>
          )}
          {unit === "defense" && view === "field" && !drawing && (
            <>
              <Button
                size="lg"
                variant={adjusting ? "default" : "outline"}
                aria-pressed={adjusting}
                onClick={() => {
                  setAdjusting((a) => !a);
                  setDrawing(false);
                }}
                disabled={!editable}
              >
                <Move aria-hidden="true" />
                {adjusting ? "Done" : "Adjust X's"}
              </Button>
              {adjusting && current?.defenseOverrides && (
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() =>
                    saveCards(
                      cards.map((c) =>
                        c.id === current.id ? { ...c, defenseOverrides: undefined } : c,
                      ),
                    )
                  }
                >
                  <RotateCcw aria-hidden="true" />
                  Reset X&apos;s
                </Button>
              )}
            </>
          )}
          {demoMode && (
            <Button asChild size="lg" variant="outline">
              <Link href="/#upload">
                <Upload aria-hidden="true" />
                Use your own film
              </Link>
            </Button>
          )}
          {!practice && !demoMode && (
            <>
              {!isPlaybook && (
                <Button asChild size="lg" variant="outline">
                  <Link href="/practice">
                    <ClipboardList aria-hidden="true" />
                    Playsheet
                  </Link>
                </Button>
              )}
              <Button size="lg" variant="outline" onClick={() => addFilmInput.current?.click()}>
                <FilePlus2 aria-hidden="true" />
                <span className="hidden xl:inline">{isPlaybook ? "Add plays" : "Add film"}</span>
                <span className="xl:hidden">{isPlaybook ? "Plays" : "Film"}</span>
              </Button>
              <Button size="lg" variant="outline" onClick={() => setGenerating(true)}>
                <Sparkles aria-hidden="true" />
                <span className="hidden xl:inline">AI card</span>
                <span className="xl:hidden">AI</span>
              </Button>
            </>
          )}
          <Button
            size="lg"
            onClick={() => setEditing(true)}
            disabled={!editable || demoMode || view !== "field"}
          >
            <Pencil aria-hidden="true" />
            Edit play
          </Button>
          <input
            ref={addFilmInput}
            type="file"
            accept=".csv,.xlsx,text/csv"
            multiple
            className="sr-only"
            aria-label="Add Hudl breakdown files"
            onChange={(e) => {
              void addFilms(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {unit === "defense" && view === "field" && adjusting && current && editable && (
        <SafetyDepthControl
          value={current.defenseAlignment}
          autoStyle={coverageStyleFor(current.coverage)}
          drawnDepths={drawnSafetyDepths}
          onChange={setDefenseAlignment}
        />
      )}

      {reviewing && view === "field" && current && editable && !practice && (
        <ReviewBar
          card={current}
          cards={cards}
          position={position}
          shown={filtered.length}
          onlyUnchecked={onlyUnchecked}
          onOnlyUnchecked={(on) => {
            setOnlyUnchecked(on);
            setIndex(0);
          }}
          onRight={() => {
            markChecked(current.id, true);
            afterChecked(current.id);
          }}
          onUndo={() => markChecked(current.id, false)}
          onFix={() => setEditing(true)}
          onSummary={() => setSummaryOpen(true)}
        />
      )}
      <ReviewSummaryDialog open={summaryOpen} onOpenChange={setSummaryOpen} cards={cards} film={script.fileName} />

      <ImportNotice
        heading={
          notice.trigger
            ? notice.heading
            : `Loaded ${cards.length} ${cards.length === 1 ? "play" : "plays"}`
        }
        detail={notice.trigger ? notice.detail : script.films.join(", ")}
        warnings={notice.trigger ? notice.warnings : script.warnings}
        trigger={notice.trigger}
      />

      {generateDialog}

      {secondaryOpen && (
        <SecondaryDialog
          open={secondaryOpen}
          onOpenChange={setSecondaryOpen}
          cards={cards}
          initialFormation={current?.formationKey ?? "spread"}
          alignments={script.dbAlignments ?? {}}
          mode={cardMode}
          onSave={(key, alignment) => {
            const next = { ...script.dbAlignments };
            if (alignment) next[key] = alignment;
            else delete next[key];
            setScript(storeScript({ ...script, dbAlignments: next }, slot));
            setSecondaryOpen(false);
          }}
        />
      )}

      {current && editing && (
        <EditPlayDialog
          key={current.id}
          card={current}
          unit={unit}
          mode={cardMode}
          open={editing}
          onOpenChange={setEditing}
          onSave={(updated) => {
            // In Review mode, saving a fix counts as checking the play.
            const saved = reviewing && !updated.reviewedAt ? { ...updated, reviewedAt: new Date().toISOString() } : updated;
            saveCards(cards.map((c) => (c.id === saved.id ? saved : c)));
            setEditing(false);
            if (reviewing && !updated.reviewedAt) afterChecked(saved.id);
          }}
          onDuplicate={(copy) => {
            const at = cards.findIndex((c) => c.id === current.id);
            const dup = {
              ...copy,
              id: `${current.id}-copy-${Date.now().toString(36)}`,
              edited: true,
            };
            saveCards([...cards.slice(0, at + 1), dup, ...cards.slice(at + 1)]);
            setIndex(position + 1);
            setEditing(false);
          }}
          onDelete={(card) => {
            saveCards(cards.filter((c) => c.id !== card.id));
            setEditing(false);
          }}
        />
      )}

      <TabsContent value="field" className="flex min-h-0 flex-col">
        <main className="flex min-h-0 flex-1 gap-6 px-4 py-3.5 sm:px-6">
          <div
            className="relative min-h-0 min-w-0 flex-1 touch-pan-y select-none [container-type:size]"
            onPointerDown={(e) => {
              pointerStart.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={(e) => {
              const start = pointerStart.current;
              pointerStart.current = null;
              // No swiping while dragging X's around or drawing.
              if (!start || drawing || (adjusting && unit === "defense") || (adjustingArrows && unit === "offense")) return;
              const dx = e.clientX - start.x;
              const dy = e.clientY - start.y;
              if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
              if (dx < 0) next();
              else prev();
            }}
            onPointerCancel={() => {
              pointerStart.current = null;
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              {current ? (
                <div
                  style={{
                    width: `min(100cqw, calc(100cqh * ${SCOUT_CARD_ASPECT}))`,
                  }}
                >
                  <ScoutCard
                    card={current}
                    mode={cardMode}
                    unit={unit}
                    tendencies={editable && !isPlaybook ? tendencies : undefined}
                    contrast={sunlight ? "high" : "normal"}
                    onMoveDefender={
                      adjusting && unit === "defense"
                        ? (id, at) =>
                            saveCards(
                              cards.map((c) =>
                                c.id === current.id
                                  ? {
                                      ...c,
                                      defenseOverrides: {
                                        ...c.defenseOverrides,
                                        [id]: at,
                                      },
                                      edited: true,
                                    }
                                  : c,
                              ),
                            )
                        : undefined
                    }
                    ink={
                      drawing
                        ? {
                            color: inkColor,
                            onStroke: (stroke) => {
                              setConfirmClear(false);
                              setStrokes((s) => [...s, stroke]);
                            },
                          }
                        : undefined
                    }
                    onEditDetectedRoute={
                      editable && !drawing
                        ? (letter, path, route) =>
                            saveCards(
                              cards.map((c) => {
                                if (c.id !== current.id) return c;
                                const own = c.routeOverrides?.[letter];
                                return {
                                  ...c,
                                  routeOverrides: {
                                    ...c.routeOverrides,
                                    // A route the play call drew keeps its number; the shape is the coach's.
                                    [letter]: {
                                      ...(own?.route ? {} : route ? { route } : {}),
                                      ...own,
                                      path,
                                      source: own?.source ?? "coach",
                                    },
                                  },
                                  edited: true,
                                };
                              }),
                            )
                        : undefined
                    }
                    adjustRoutes={adjustingArrows && unit === "offense"}
                    onAssignmentChange={(key, text) =>
                      saveCards(
                        cards.map((c) => {
                          if (c.id !== current.id) return c;
                          if (key === "NOTES") return { ...c, notes: text, edited: true };
                          // An empty box goes back to the generated assignment.
                          const own = { ...c.assignmentNotes };
                          if (text) own[key] = text;
                          else delete own[key];
                          return { ...c, assignmentNotes: own, edited: true };
                        }),
                      )
                    }
                  />
                </div>
              ) : practicePeriod ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-[14px] border-2 border-dashed border-input px-6 text-center">
                  <p className="font-display text-3xl font-bold">
                    {practicePeriod.side === "offense"
                      ? "No calls on the playsheet for this period"
                      : `No ${practicePeriod.kind === "7v7" ? "passes" : "plays"} in the opponent's film`}
                  </p>
                  <Button asChild size="lg" variant="outline">
                    <Link href={`/practice?day=${practice?.day.id ?? ""}`}>
                      <ClipboardList aria-hidden="true" />
                      Open the playsheet
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-[14px] border-2 border-dashed border-input">
                  <p className="font-display text-3xl font-bold">No plays match these filters</p>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={() => {
                      setDown("all");
                      setFormation("all");
                      setIndex(0);
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              )}
            </div>
          </div>

          <aside className="hidden w-[330px] shrink-0 flex-col gap-2.5 lg:flex">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-bold tracking-[0.12em] text-muted-foreground">
                SCRIPT
              </span>
              <span className="font-display text-xl font-bold tabular-nums">
                {filtered.length ? `${position + 1} / ${filtered.length}` : "0 / 0"}
              </span>
            </div>
            <ol ref={railRef} className="flex min-h-0 flex-col gap-2.5 overflow-y-auto pr-1">
              {filtered.map((card, i) => {
                const active = i === position;
                return (
                  <li key={card.id}>
                    <button
                      type="button"
                      aria-current={active}
                      onClick={() => setIndex(i)}
                      className={cn(
                        "flex min-h-16 w-full items-center gap-3 rounded-xl border-2 px-3.5 py-2.5 text-left transition-colors",
                        "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                        active ? "border-primary bg-muted" : "border-border bg-card hover:bg-muted",
                      )}
                    >
                      <span
                        className={cn(
                          "font-display w-9 text-[26px] font-extrabold tabular-nums",
                          active ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        {String(card.playNumber).padStart(2, "0")}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-base font-bold">
                          {card.formation || "—"}
                          {card.hash && ` · ${card.hash} hash`}
                        </span>
                        <span className="truncate text-sm text-muted-foreground">
                          {(multiFilm || card.source.startsWith("AI generated")) &&
                            `${card.source.replace(/\.(csv|xlsx)$/i, "")} · `}
                          {unit === "defense"
                            ? [card.defFront || "—", card.coverage].filter(Boolean).join(" · ")
                            : card.playCall || "—"}
                          {card.aiHints && " · AI"}
                          {card.edited && " · edited"}
                          {card.reviewedAt && (reviewStatus(card) === "fixed" ? " · fixed" : " · ✓")}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>
        </main>

        <footer className="grid h-28 shrink-0 grid-cols-2 gap-4 border-t px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={prev}
            disabled={!canPrev && !hasPrevPeriod}
            className="font-display flex items-center justify-center gap-3.5 rounded-2xl border-2 border-input bg-secondary text-2xl font-extrabold tracking-[0.04em] transition-opacity focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:bg-muted disabled:opacity-40 sm:text-[34px]"
          >
            <ChevronLeft className="size-8" strokeWidth={3} aria-hidden="true" />
            {!canPrev && hasPrevPeriod ? "PREVIOUS PERIOD" : "PREVIOUS CARD"}
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!canNext && !hasNextPeriod}
            className="font-display flex items-center justify-center gap-3.5 rounded-2xl bg-primary text-2xl font-extrabold tracking-[0.04em] text-primary-foreground transition-opacity focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:bg-primary/85 disabled:opacity-40 sm:text-[34px]"
          >
            {!canNext && hasNextPeriod ? "NEXT PERIOD" : "NEXT CARD"}
            <ChevronRight className="size-8" strokeWidth={3} aria-hidden="true" />
          </button>
        </footer>
      </TabsContent>

      <TabsContent value="print" className="flex flex-col">
        <PrintGrid
          cards={filtered}
          fileName={
            practice && practicePeriod
              ? `${practice.day.name} · ${practicePeriod.name}`
              : script.fileName
          }
          mode={cardMode}
          unit={unit}
        />
      </TabsContent>
    </Tabs>
  );
}

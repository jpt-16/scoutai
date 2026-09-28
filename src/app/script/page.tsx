"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Grid2x2, RectangleVertical, Upload } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { FilterGroup, type FilterOption } from "@/components/FilterBar";
import { PrintGrid } from "@/components/PrintGrid";
import { ScoutCard, SCOUT_CARD_ASPECT } from "@/components/ScoutCard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEMO_CSV, DEMO_FILE_NAME } from "@/lib/demoScript";
import { FORMATION_LABELS } from "@/lib/formations";
import { parseHudlCsvText, type FormationKey, type HudlPlayCard } from "@/lib/hudlParser";
import { loadScript, saveScript, type StoredScript } from "@/lib/scriptStore";
import { cn } from "@/lib/utils";

type View = "field" | "print";
type DownFilter = "all" | 1 | 2 | 3 | 4;
type FormationFilter = "all" | FormationKey;

const DOWN_LABELS: Record<Exclude<DownFilter, "all">, string> = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" };
const FORMATION_ORDER: FormationKey[] = ["spread", "trips", "i-form", "pro", "double-eagle", "unknown"];
const SWIPE_THRESHOLD = 60;

export default function ScriptPage() {
  const router = useRouter();
  // undefined while reading localStorage, null when nothing is loaded.
  const [script, setScript] = useState<StoredScript | null | undefined>(undefined);
  const [view, setView] = useState<View>("field");
  const [down, setDown] = useState<DownFilter>("all");
  const [formation, setFormation] = useState<FormationFilter>("all");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setScript(loadScript());
  }, []);

  const cards = useMemo(() => script?.cards ?? [], [script]);
  const filtered = useMemo(
    () =>
      cards.filter(
        (c) =>
          (down === "all" || c.down === down) && (formation === "all" || c.formationKey === formation),
      ),
    [cards, down, formation],
  );

  const downOptions: FilterOption<DownFilter>[] = [
    { value: "all", label: "All", count: cards.length },
    ...([1, 2, 3, 4] as const).map((d) => ({
      value: d,
      label: DOWN_LABELS[d],
      count: cards.filter((c) => c.down === d).length,
    })),
  ];
  const formationOptions: FilterOption<FormationFilter>[] = [
    { value: "all", label: "All", count: cards.length },
    ...FORMATION_ORDER.map((key) => ({
      value: key,
      label: FORMATION_LABELS[key],
      count: cards.filter((c) => c.formationKey === key).length,
    })).filter((o) => o.count > 0),
  ];

  const position = Math.min(index, Math.max(filtered.length - 1, 0));
  const current: HudlPlayCard | undefined = filtered[position];
  const canPrev = position > 0;
  const canNext = position < filtered.length - 1;

  const prev = useCallback(() => setIndex((i) => Math.max(0, Math.min(i, filtered.length - 1) - 1)), [filtered.length]);
  const next = useCallback(
    () => setIndex((i) => Math.min(filtered.length - 1, Math.min(i, filtered.length - 1) + 1)),
    [filtered.length],
  );

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

  const setFilter = <T,>(setter: (v: T) => void) => (value: T) => {
    setter(value);
    setIndex(0);
  };

  const loadDemo = () => {
    setScript(saveScript(DEMO_FILE_NAME, parseHudlCsvText(DEMO_CSV)));
    setIndex(0);
  };

  if (script === undefined) return <div className="min-h-dvh" />;

  if (script === null || cards.length === 0) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
        <BrandMark />
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-4xl font-bold">No scout script loaded</h1>
          <p className="text-lg text-muted-foreground">
            Upload this week&apos;s Hudl breakdown, or try the 5-play demo.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button size="xl" onClick={() => router.push("/")}>
            <Upload aria-hidden="true" />
            Upload a Hudl CSV
          </Button>
          <Button size="xl" variant="outline" onClick={loadDemo}>
            Load demo script
          </Button>
        </div>
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
          <Link href="/" aria-label="Back to upload">
            <ChevronLeft className="size-5" />
          </Link>
        </Button>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs font-bold tracking-[0.14em] text-primary">SCOUT SCRIPT</span>
          <span className="font-display truncate text-2xl leading-[1.05] font-bold">
            {script.fileName} · {cards.length} plays
          </span>
        </div>
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

      <div className="no-print flex h-16 shrink-0 items-center gap-5 overflow-x-auto border-b px-4 sm:px-6">
        <FilterGroup label="DOWN" options={downOptions} value={down} onChange={setFilter(setDown)} />
        <span className="h-7 w-px shrink-0 bg-border" aria-hidden="true" />
        <FilterGroup
          label="FORMATION"
          options={formationOptions}
          value={formation}
          onChange={setFilter(setFormation)}
        />
      </div>

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
              if (!start) return;
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
                <div style={{ width: `min(100cqw, calc(100cqh * ${SCOUT_CARD_ASPECT}))` }}>
                  <ScoutCard card={current} />
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
              <span className="text-xs font-bold tracking-[0.12em] text-muted-foreground">SCRIPT</span>
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
                          {card.downDistance}
                          {card.hash && ` · ${card.hash} hash`}
                        </span>
                        <span className="truncate text-sm text-muted-foreground">
                          {card.formation || "—"} · {card.playCall || "—"}
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
            disabled={!canPrev}
            className="font-display flex items-center justify-center gap-3.5 rounded-2xl border-2 border-input bg-secondary text-2xl font-extrabold tracking-[0.04em] transition-opacity focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:bg-muted disabled:opacity-40 sm:text-[34px]"
          >
            <ChevronLeft className="size-8" strokeWidth={3} aria-hidden="true" />
            PREVIOUS CARD
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!canNext}
            className="font-display flex items-center justify-center gap-3.5 rounded-2xl bg-primary text-2xl font-extrabold tracking-[0.04em] text-primary-foreground transition-opacity focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:bg-primary/85 disabled:opacity-40 sm:text-[34px]"
          >
            NEXT CARD
            <ChevronRight className="size-8" strokeWidth={3} aria-hidden="true" />
          </button>
        </footer>
      </TabsContent>

      <TabsContent value="print" className="flex flex-col">
        <PrintGrid cards={filtered} fileName={script.fileName} />
      </TabsContent>
    </Tabs>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  BookOpen,
  ClipboardList,
  Play,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { AppGate } from "@/components/AppGate";
import { PlaybookPicker } from "@/components/PlaybookPicker";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { FORMATION_LABELS } from "@/lib/formations";
import type { FormationKey, HudlPlayCard } from "@/lib/hudlParser";
import {
  aliasKey,
  assignLooks,
  loadPlan,
  lookKey,
  lookLabel,
  newDay,
  newPeriod,
  nextDayName,
  opponentLooks,
  parsePlaysheet,
  periodScoutOCards,
  playbookCallLine,
  repFormationKey,
  savePlan,
  setLineLook,
  type PeriodKind,
  type PeriodSide,
  type PracticeDay,
  type PracticePeriod,
  type PracticePlan,
  type ScoutLook,
} from "@/lib/practicePlan";
import { loadScript, type StoredScript } from "@/lib/scriptStore";
import { cn } from "@/lib/utils";

const inputClass =
  "h-11 w-full rounded-lg border-2 border-input bg-background px-3 text-base font-semibold outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

const ALIAS_SHAPES: FormationKey[] = ["spread", "trips", "i-form", "pro", "split-pro", "double-eagle"];

const PLACEHOLDER = `1. TRIPS RT 836
2. DEUCES LT IZ
3. RH PRO RT POWER
4. TRIPS LT 92 vs 3-4 C1`;

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 rounded-lg border-2 border-input p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-10 rounded-md px-3 text-sm font-bold whitespace-nowrap transition-colors",
            "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            value === o.value ? "bg-primary text-primary-foreground" : "hover:bg-accent",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function runHref(day: PracticeDay, periodIndex?: number) {
  const q = new URLSearchParams({ practice: day.id });
  if (periodIndex != null) q.set("period", String(periodIndex));
  return `/script?${q}`;
}

/** Our offense's period: the calls, pasted as the playsheet has them, with a look per rep. */
function OffensePeriod({
  period,
  looks,
  aliases,
  playbook,
  onText,
  onAlias,
  onAddPlaybook,
}: {
  period: PracticePeriod;
  looks: ScoutLook[];
  aliases: Record<string, FormationKey>;
  /** The staff's saved playbook (our offense's plays), if there is one. */
  playbook: HudlPlayCard[];
  onText: (text: string) => void;
  onAlias: (word: string, key: FormationKey) => void;
  onAddPlaybook: (picked: HudlPlayCard[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const reps = useMemo(
    () =>
      parsePlaysheet(period.text).map((r) => ({
        ...r,
        formationKey: repFormationKey(r, aliases),
      })),
    [period.text, aliases],
  );
  const picks = useMemo(() => assignLooks(reps, looks), [reps, looks]);
  const unknownWords = [
    ...new Set(reps.filter((r) => r.formationKey === "unknown").map((r) => aliasKey(r.call))),
  ].filter(Boolean);
  const textId = `calls-${period.id}`;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col gap-2">
        <label htmlFor={textId} className="text-xs font-bold tracking-[0.12em] text-muted-foreground">
          CALLS, IN ORDER
        </label>
        <textarea
          id={textId}
          value={period.text}
          onChange={(e) => onText(e.target.value)}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          rows={Math.max(6, Math.min(16, period.text.split("\n").length + 1))}
          className="w-full resize-y rounded-lg border-2 border-input bg-background px-3 py-2.5 font-mono text-[15px] leading-relaxed uppercase outline-none placeholder:normal-case placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <div className="flex flex-wrap items-center gap-2">
          {playbook.length > 0 ? (
            <Button variant="outline" size="lg" onClick={() => setPicking(true)}>
              <BookOpen aria-hidden="true" />
              Add from your playbook · {playbook.length}
            </Button>
          ) : (
            <Button asChild variant="outline" size="lg">
              <Link href="/#playbook">
                <BookOpen aria-hidden="true" />
                Upload your playbook to pick plays
              </Link>
            </Button>
          )}
        </div>
        <PlaybookPicker
          open={picking}
          onOpenChange={setPicking}
          cards={playbook}
          kind={period.kind}
          onAdd={onAddPlaybook}
        />
        <p className="text-sm leading-relaxed text-muted-foreground">
          One call per line, exactly as it reads on your playsheet. Rows copied from Excel or Sheets keep
          their hash column; typed lines take <span className="font-semibold text-foreground">LH / RH</span>.
          Add <span className="font-semibold text-foreground">vs 3-4 C1</span> to call a look yourself.
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-xs font-bold tracking-[0.12em] text-muted-foreground">
          SCOUT D CARDS · {reps.length}
        </span>
        {reps.length === 0 ? (
          <div className="flex min-h-40 flex-1 items-center justify-center rounded-xl border-2 border-dashed border-input p-4 text-center text-sm text-muted-foreground">
            Each call becomes a Scout D card: your formation, their front and coverage.
          </div>
        ) : (
          <ol className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
            {reps.map((rep, i) => {
              const pick = picks[i];
              const written = rep.look ? lookKey(rep.look.front, rep.look.coverage) : null;
              const writtenKnown = written != null && looks.some((l) => l.key === written);
              return (
                <li
                  key={`${rep.line}-${i}`}
                  className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 sm:grid-cols-[28px_minmax(0,1fr)_minmax(0,210px)]"
                >
                  <span className="font-display text-xl font-extrabold text-muted-foreground tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-base font-bold uppercase">{rep.call}</span>
                    <span className="truncate text-xs font-semibold text-muted-foreground">
                      {FORMATION_LABELS[rep.formationKey === "unknown" ? "spread" : rep.formationKey]}
                      {rep.formationKey === "unknown" && " (not recognized)"}
                      {rep.hash && ` · ${rep.hash} hash`}
                    </span>
                  </span>
                  <select
                    aria-label={`Look for call ${i + 1}`}
                    value={written ? (writtenKnown ? written : "written") : "auto"}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "written") return;
                      const look = looks.find((l) => l.key === v);
                      onText(setLineLook(period.text, rep.line, v === "auto" || !look ? null : look));
                    }}
                    className={cn(inputClass, "col-start-2 h-10 text-sm sm:col-start-3")}
                  >
                    <option value="auto">
                      {pick?.fromFilm
                        ? `Film: ${lookLabel(pick)}`
                        : looks.length
                          ? "Film tendency"
                          : "4-3 (no film)"}
                    </option>
                    {written && !writtenKnown && rep.look && (
                      <option value="written">Playsheet: {lookLabel(rep.look)}</option>
                    )}
                    {looks.map((l) => (
                      <option key={l.key} value={l.key}>
                        {lookLabel(l)} ({l.count})
                      </option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ol>
        )}
        {unknownWords.map((word) => (
          <div
            key={word}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm"
          >
            <TriangleAlert className="size-4 shrink-0 text-amber-400" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="font-bold">{word}</span> isn&apos;t a formation the app knows. Draw it as:
            </span>
            <select
              aria-label={`Formation for ${word}`}
              value=""
              onChange={(e) => e.target.value && onAlias(word, e.target.value as FormationKey)}
              className={cn(inputClass, "h-10 w-auto text-sm")}
            >
              <option value="">Pick a shape…</option>
              {ALIAS_SHAPES.map((k) => (
                <option key={k} value={k}>
                  {FORMATION_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PracticePage() {
  return (
    <AppGate>
      <PracticeApp />
    </AppGate>
  );
}

function PracticeApp() {
  // undefined while reading localStorage.
  const [plan, setPlan] = useState<PracticePlan | undefined>(undefined);
  const [script, setScript] = useState<StoredScript | null>(null);
  const [playbook, setPlaybook] = useState<HudlPlayCard[]>([]);
  const [dayId, setDayId] = useState<string | null>(null);

  useEffect(() => {
    const loaded = loadPlan();
    setPlan(loaded);
    setScript(loadScript());
    setPlaybook(loadScript("playbook")?.cards ?? []);
    const wanted = new URLSearchParams(window.location.search).get("day");
    setDayId(loaded.days.find((d) => d.id === wanted)?.id ?? loaded.days[0]?.id ?? null);
  }, []);

  const cards: HudlPlayCard[] = useMemo(() => script?.cards ?? [], [script]);
  const looks = useMemo(() => opponentLooks(cards), [cards]);

  if (!plan) return <div className="min-h-dvh" />;
  const day = plan.days.find((d) => d.id === dayId) ?? plan.days[0];

  const commit = (next: PracticePlan) => setPlan(savePlan(next));
  const updateDay = (change: (d: PracticeDay) => PracticeDay) =>
    commit({
      ...plan,
      days: plan.days.map((d) => (d.id === day.id ? change(d) : d)),
    });
  const updatePeriod = (id: string, change: Partial<PracticePeriod>) =>
    updateDay((d) => ({
      ...d,
      periods: d.periods.map((p) => (p.id === id ? { ...p, ...change } : p)),
    }));
  const movePeriod = (from: number, to: number) =>
    updateDay((d) => {
      const periods = [...d.periods];
      const [moved] = periods.splice(from, 1);
      periods.splice(to, 0, moved);
      return { ...d, periods };
    });

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
        <Button asChild variant="outline" size="icon" className="border">
          <Link href="/script" aria-label="Back to the scout script">
            <ChevronLeft className="size-5" />
          </Link>
        </Button>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs font-bold tracking-[0.14em] text-primary">PRACTICE PLAYSHEET</span>
          <span className="font-display truncate text-2xl leading-[1.05] font-bold">
            {day.name} · {day.periods.length} {day.periods.length === 1 ? "period" : "periods"}
          </span>
        </div>
        <Button asChild size="lg" className="shrink-0">
          <Link href={runHref(day)}>
            <Play aria-hidden="true" />
            Run {day.name}
          </Link>
        </Button>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-bold tracking-[0.12em] text-muted-foreground">DAY</span>
            {plan.days.map((d) => (
              <button
                key={d.id}
                type="button"
                aria-pressed={d.id === day.id}
                onClick={() => setDayId(d.id)}
                className={cn(
                  "flex h-11 items-center gap-1.5 rounded-[10px] border px-4 text-base font-bold transition-colors",
                  "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                  d.id === day.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-accent",
                )}
              >
                {d.name}
              </button>
            ))}
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                const added = newDay(nextDayName(plan));
                commit({ ...plan, days: [...plan.days, added] });
                setDayId(added.id);
              }}
            >
              <Plus aria-hidden="true" />
              Add day
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="day-name" className="text-xs font-bold tracking-[0.12em] text-muted-foreground">
              NAME
            </label>
            <input
              id="day-name"
              value={day.name}
              onChange={(e) => updateDay((d) => ({ ...d, name: e.target.value }))}
              className={cn(inputClass, "w-48")}
            />
            {plan.days.length > 1 && (
              <Button
                variant="ghost"
                size="lg"
                className="text-muted-foreground"
                onClick={() => {
                  const rest = plan.days.filter((d) => d.id !== day.id);
                  commit({ ...plan, days: rest });
                  setDayId(rest[0].id);
                }}
              >
                <Trash2 aria-hidden="true" />
                Remove day
              </Button>
            )}
          </div>
        </section>

        {cards.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <TriangleAlert className="size-4 shrink-0 text-amber-400" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              No opponent film loaded yet. Load their Hudl breakdown and each Scout D card gets the fronts and
              coverages they actually played; until then cards draw a 4-3.
            </span>
            <Button asChild variant="outline" size="lg">
              <Link href="/#upload">Load film</Link>
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Scout D looks come from <span className="font-semibold text-foreground">{script?.fileName}</span>:{" "}
            {looks.length
              ? `${looks.length} ${looks.length === 1 ? "look" : "looks"}, matched to what they played against each formation.`
              : "no fronts or coverages tagged, so cards draw a 4-3 unless you call a look."}
          </p>
        )}

        <ol className="flex flex-col gap-4">
          {day.periods.map((period, i) => {
            const scoutO = periodScoutOCards(period, cards).length;
            return (
              <li key={period.id} className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="font-display flex size-11 shrink-0 items-center justify-center rounded-lg bg-foreground text-2xl font-extrabold text-background tabular-nums">
                    {i + 1}
                  </span>
                  <input
                    aria-label={`Period ${i + 1} name`}
                    value={period.name}
                    onChange={(e) => updatePeriod(period.id, { name: e.target.value })}
                    className={cn(inputClass, "w-40 min-w-0 flex-1 sm:flex-none")}
                  />
                  <Segmented<PeriodKind>
                    label="Period type"
                    value={period.kind}
                    options={[
                      { value: "7v7", label: "7v7" },
                      { value: "team", label: "Team" },
                    ]}
                    onChange={(kind) => updatePeriod(period.id, { kind })}
                  />
                  <Segmented<PeriodSide>
                    label="Which side is ours"
                    value={period.side}
                    options={[
                      { value: "offense", label: "Our O · Scout D" },
                      { value: "defense", label: "Our D · Scout O" },
                    ]}
                    onChange={(side) => updatePeriod(period.id, { side })}
                  />
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Move period up"
                      disabled={i === 0}
                      onClick={() => movePeriod(i, i - 1)}
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Move period down"
                      disabled={i === day.periods.length - 1}
                      onClick={() => movePeriod(i, i + 1)}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove period"
                      onClick={() =>
                        updateDay((d) => ({
                          ...d,
                          periods: d.periods.filter((p) => p.id !== period.id),
                        }))
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                    <Button asChild variant="outline" size="lg">
                      <Link href={runHref(day, i)}>
                        <Play aria-hidden="true" />
                        Run
                      </Link>
                    </Button>
                  </div>
                </div>

                {period.side === "offense" ? (
                  <OffensePeriod
                    period={period}
                    looks={looks}
                    aliases={plan.formationAliases}
                    playbook={playbook}
                    onAddPlaybook={(picked) => {
                      // Each pick is a line, in the staff's own words. A formation name the app
                      // doesn't know but the playbook import already placed keeps that shape.
                      const lines = picked.map(playbookCallLine);
                      const aliases = { ...plan.formationAliases };
                      picked.forEach((c, k) => {
                        const rep = { call: lines[k], formation: lines[k] };
                        if (repFormationKey(rep, aliases) === "unknown" && c.formationKey !== "unknown") {
                          aliases[aliasKey(lines[k])] = c.formationKey;
                        }
                      });
                      const text = [period.text.trimEnd(), ...lines].filter(Boolean).join("\n");
                      commit({
                        ...plan,
                        formationAliases: aliases,
                        days: plan.days.map((d) =>
                          d.id === day.id
                            ? { ...d, periods: d.periods.map((p) => (p.id === period.id ? { ...p, text } : p)) }
                            : d,
                        ),
                      });
                    }}
                    onText={(text) => updatePeriod(period.id, { text })}
                    onAlias={(word, key) =>
                      commit({
                        ...plan,
                        formationAliases: {
                          ...plan.formationAliases,
                          [word]: key,
                        },
                      })
                    }
                  />
                ) : (
                  <p className="rounded-xl bg-muted/50 px-4 py-3 text-base leading-relaxed text-muted-foreground">
                    Your defensive coach makes the calls. Scout O runs the opponent&apos;s{" "}
                    {period.kind === "7v7" ? "passes" : "plays"} from film as usual:{" "}
                    <span className="font-semibold text-foreground">
                      {scoutO} {scoutO === 1 ? "card" : "cards"}
                    </span>
                    .
                  </p>
                )}
              </li>
            );
          })}
        </ol>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              const last = day.periods.at(-1);
              const side: PeriodSide = last?.side === "offense" ? "defense" : "offense";
              updateDay((d) => ({
                ...d,
                periods: [...d.periods, newPeriod(d.periods.length, last?.kind ?? "team", side)],
              }));
            }}
          >
            <Plus aria-hidden="true" />
            Add period
          </Button>
          {Object.keys(plan.formationAliases).length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              <ClipboardList className="size-4" aria-hidden="true" />
              Your names:
              {Object.entries(plan.formationAliases).map(([word, key]) => (
                <button
                  key={word}
                  type="button"
                  title="Remove"
                  onClick={() => {
                    const rest = { ...plan.formationAliases };
                    delete rest[word];
                    commit({ ...plan, formationAliases: rest });
                  }}
                  className="h-9 rounded-md border px-2.5 font-semibold text-foreground hover:bg-accent"
                >
                  {word} = {FORMATION_LABELS[key]} ×
                </button>
              ))}
            </div>
          )}
        </div>

        <footer className="flex items-center gap-3 border-t pt-6 text-sm text-muted-foreground">
          <BrandMark />
          <span>Saved on this device. Nothing is uploaded.</span>
        </footer>
      </main>
    </div>
  );
}

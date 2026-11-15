"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Hash, HudlPlayCard } from "@/lib/hudlParser";
import type { FormationFamily } from "@/lib/formationFamily";
import {
  defenseReport,
  describeFilter,
  familiesIn,
  familyLabel,
  isFiltered,
  offenseReport,
  type Bucket,
  type DistanceBucket,
  type Insight,
  type ReportFilter,
  type SplitRow,
} from "@/lib/scoutReport";
import { inPeriod } from "@/lib/formations";
import { cn } from "@/lib/utils";

type Unit = "offense" | "defense";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cards: HudlPlayCard[];
  /** The lens the reader is on; the report opens on it. */
  initialUnit: Unit;
  /** A coach tapped a number: take them to the plays behind it. */
  onShowPlays: (label: string, ids: string[], unit: Unit) => void;
}

const DOWNS = [1, 2, 3, 4] as const;
const DISTANCES: DistanceBucket[] = ["Short", "Medium", "Long"];
const HASHES: { value: Hash; label: string }[] = [
  { value: "L", label: "Left" },
  { value: "M", label: "Middle" },
  { value: "R", label: "Right" },
];

function Pill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex h-11 min-w-[44px] items-center justify-center rounded-[10px] border px-3 text-sm font-bold whitespace-nowrap transition-colors",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-transparent text-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-[11px] font-bold tracking-[0.1em] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-bold tracking-[0.1em] text-muted-foreground">{title}</h3>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** One row of a breakdown: a bar sized by its share, the count, and a tap to open the plays. */
function BarRow({
  label,
  detail,
  count,
  pct,
  ids,
  onShow,
  accent,
}: {
  label: string;
  detail?: string;
  count: number;
  pct: number;
  ids: string[];
  onShow: (label: string, ids: string[]) => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onShow(label, ids)}
      disabled={ids.length === 0}
      className="group relative flex min-h-11 items-center gap-3 overflow-hidden rounded-lg border px-3 py-1.5 text-left transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
    >
      <span
        aria-hidden="true"
        className={cn("absolute inset-y-0 left-0", accent ? "bg-primary/25" : "bg-foreground/10")}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
      <span className="relative min-w-0 flex-1 truncate text-sm font-semibold">{label}</span>
      {detail && <span className="relative text-xs text-muted-foreground">{detail}</span>}
      <span className="relative text-sm tabular-nums">
        <span className="font-bold">{count}</span>
        <span className="text-muted-foreground"> · {pct}%</span>
      </span>
      <ChevronRight aria-hidden="true" className="relative size-4 text-muted-foreground group-disabled:hidden" />
    </button>
  );
}

const gainText = (b: Bucket) => (b.gain ? `${b.gain.avg > 0 ? "+" : ""}${b.gain.avg} yd/play` : undefined);

function BucketRows({ buckets, onShow, accent }: { buckets: Bucket[]; onShow: (label: string, ids: string[]) => void; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      {buckets.map((b) => (
        <BarRow key={b.key} label={b.label} detail={gainText(b)} count={b.count} pct={b.pct} ids={b.ids} onShow={onShow} accent={accent} />
      ))}
    </div>
  );
}

function SplitRows({ rows, onShow }: { rows: SplitRow[]; onShow: (label: string, ids: string[]) => void }) {
  return (
    <div className="flex flex-col gap-1">
      {rows.map((r) => {
        const decided = r.run + r.pass;
        return (
          <div key={r.key} className="flex min-h-11 items-center gap-3 rounded-lg border px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.label}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{r.total} plays</span>
            {decided > 0 ? (
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={r.run === 0}
                  onClick={() => onShow(`${r.label}: runs`, r.runIds)}
                  className="h-9 rounded-md bg-foreground/10 px-2 text-xs font-bold tabular-nums hover:bg-accent disabled:opacity-50"
                >
                  RUN {r.run} · {r.runPct}%
                </button>
                <button
                  type="button"
                  disabled={r.pass === 0}
                  onClick={() => onShow(`${r.label}: passes`, r.passIds)}
                  className="h-9 rounded-md bg-primary/20 px-2 text-xs font-bold tabular-nums hover:bg-accent disabled:opacity-50"
                >
                  PASS {r.pass} · {100 - r.runPct}%
                </button>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">no calls read</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Insights({ insights, onShow }: { insights: Insight[]; onShow: (label: string, ids: string[]) => void }) {
  if (insights.length === 0) {
    return (
      <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        Not enough tagged plays here to say what they do. A sentence appears once a situation has at least a handful of snaps behind it.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {insights.map((i) => (
        <li key={i.text}>
          <button
            type="button"
            disabled={i.ids.length === 0}
            onClick={() => onShow(i.text, i.ids)}
            className="flex w-full items-start gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-left text-sm font-semibold hover:bg-primary/20 disabled:cursor-default disabled:hover:bg-primary/10"
          >
            <span className="flex-1">{i.text}</span>
            {i.ids.length > 0 && <ChevronRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ScoutReportDialog({ open, onOpenChange, cards, initialUnit, onShowPlays }: Props) {
  const [unit, setUnit] = useState<Unit>(initialUnit);
  const [filter, setFilter] = useState<ReportFilter>({});
  const unitCards = useMemo(() => cards.filter((c) => inPeriod(c, "all", unit)), [cards, unit]);
  const families = useMemo(() => familiesIn(unitCards), [unitCards]);
  const defense = useMemo(() => (unit === "defense" ? defenseReport(cards, filter) : null), [cards, unit, filter]);
  const offense = useMemo(() => (unit === "offense" ? offenseReport(cards, filter) : null), [cards, unit, filter]);
  const total = defense?.total ?? offense?.total ?? 0;

  const set = <K extends keyof ReportFilter>(key: K, value: ReportFilter[K]) => setFilter((f) => ({ ...f, [key]: f[key] === value ? null : value }));
  const show = (label: string, ids: string[]) => {
    if (ids.length === 0) return;
    onShowPlays(`${label}${isFiltered(filter) ? ` (${describeFilter(filter)})` : ""}`, ids, unit);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-bold">Scouting report</DialogTitle>
          <DialogDescription className="text-base">
            What they do, in the situation you pick. Tap any number to see the plays behind it.
          </DialogDescription>
        </DialogHeader>

        <div role="group" aria-label="Which side of the ball" className="flex w-fit rounded-xl border bg-secondary p-1">
          {(["defense", "offense"] as const).map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={unit === u}
              onClick={() => {
                setUnit(u);
                setFilter({});
              }}
              className={cn(
                "flex h-11 items-center rounded-[9px] px-4 text-sm font-bold whitespace-nowrap transition-colors",
                unit === u ? "bg-foreground text-background" : "text-foreground hover:bg-accent",
              )}
            >
              {u === "defense" ? "THEIR DEFENSE" : "THEIR OFFENSE"}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
          <FilterRow label="DOWN">
            <Pill selected={filter.down == null} onClick={() => setFilter((f) => ({ ...f, down: null }))}>All</Pill>
            {DOWNS.map((d) => (
              <Pill key={d} selected={filter.down === d} onClick={() => set("down", d)}>{["", "1st", "2nd", "3rd", "4th"][d]}</Pill>
            ))}
          </FilterRow>
          <FilterRow label="DISTANCE">
            <Pill selected={filter.distance == null} onClick={() => setFilter((f) => ({ ...f, distance: null }))}>All</Pill>
            {DISTANCES.map((d) => (
              <Pill key={d} selected={filter.distance === d} onClick={() => set("distance", d)}>{d}</Pill>
            ))}
          </FilterRow>
          {families.length > 1 && (
            <FilterRow label="FORMATION">
              <Pill selected={filter.family == null} onClick={() => setFilter((f) => ({ ...f, family: null }))}>All</Pill>
              {families.map(({ family, count }) => (
                <Pill key={family} selected={filter.family === family} onClick={() => set("family", family as FormationFamily)}>
                  {familyLabel(family)} <span className="ml-1.5 text-xs opacity-70">{count}</span>
                </Pill>
              ))}
            </FilterRow>
          )}
          <FilterRow label="HASH">
            <Pill selected={filter.hash == null} onClick={() => setFilter((f) => ({ ...f, hash: null }))}>All</Pill>
            {HASHES.map((h) => (
              <Pill key={h.value} selected={filter.hash === h.value} onClick={() => set("hash", h.value)}>{h.label}</Pill>
            ))}
          </FilterRow>
        </div>

        <p className="text-sm text-muted-foreground">
          <span className="font-bold text-foreground">{total}</span> {total === 1 ? "play" : "plays"} · {describeFilter(filter)}
        </p>

        {total === 0 && (
          <p className="rounded-xl bg-muted/50 px-4 py-3 text-base text-muted-foreground">No plays here. Loosen a filter.</p>
        )}

        {defense && total > 0 && (
          <>
            <Section title="WHERE TO ATTACK" note="each line says how many snaps it rests on">
              <Insights insights={defense.insights} onShow={show} />
            </Section>
            <Section title="FRONTS" note="of all plays">
              <BucketRows buckets={defense.fronts} onShow={show} />
            </Section>
            <Section
              title="BLITZ"
              note={defense.pressure.tagged ? `${defense.pressure.blitz} of ${defense.pressure.tagged} tagged snaps · ${defense.pressure.rate}%` : undefined}
            >
              {defense.pressure.tagged === 0 ? (
                <p className="text-sm text-muted-foreground">No coverage or blitz is tagged on these plays, so there is no blitz rate to read.</p>
              ) : (
                <>
                  {defense.pressure.calls.length > 0 && <BucketRows buckets={defense.pressure.calls} onShow={show} accent />}
                  <div className="grid grid-cols-4 gap-1.5">
                    {defense.pressure.byDown.map((d) => (
                      <button
                        key={d.down}
                        type="button"
                        disabled={d.blitz === 0}
                        onClick={() => show(`Blitz on ${["", "1st", "2nd", "3rd", "4th"][d.down]} down`, d.ids)}
                        className="rounded-lg border px-2 py-2 text-center hover:bg-accent disabled:opacity-60"
                      >
                        <div className="font-display text-2xl font-extrabold tabular-nums">{d.rate}%</div>
                        <div className="text-[11px] font-bold tracking-[0.1em] text-muted-foreground">
                          {["", "1ST", "2ND", "3RD", "4TH"][d.down]} · {d.blitz}/{d.tagged}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </Section>
            <Section
              title="COVERAGE"
              note={
                defense.manZone.man + defense.manZone.zone > 0
                  ? `man ${defense.manZone.man} · zone ${defense.manZone.zone}`
                  : undefined
              }
            >
              {defense.coverages.length === 0 ? (
                <p className="text-sm text-muted-foreground">No coverage tagged on the plays that weren&apos;t blitzes.</p>
              ) : (
                <BucketRows buckets={defense.coverages} onShow={show} />
              )}
            </Section>
            {defense.untagged > 0 && (
              <p className="text-xs text-muted-foreground">
                {defense.untagged} {defense.untagged === 1 ? "play has" : "plays have"} no coverage or blitz tag and {defense.untagged === 1 ? "isn't" : "aren't"} in the blitz or coverage numbers.
              </p>
            )}
          </>
        )}

        {offense && total > 0 && (
          <>
            <Section title="WHERE TO ATTACK" note="each line says how many snaps it rests on">
              <Insights insights={offense.insights} onShow={show} />
            </Section>
            <Section title="RUN AND PASS">
              <SplitRows rows={[offense.overall]} onShow={show} />
            </Section>
            {offense.byDown.length > 0 && (
              <Section title="BY DOWN">
                <SplitRows rows={offense.byDown} onShow={show} />
              </Section>
            )}
            {offense.byDistance.length > 0 && (
              <Section title="BY DISTANCE" note="1-3 short · 4-6 medium · 7+ long">
                <SplitRows rows={offense.byDistance} onShow={show} />
              </Section>
            )}
            {offense.formations.length > 0 && (
              <Section title="BY FORMATION">
                <SplitRows rows={offense.formations} onShow={show} />
              </Section>
            )}
            {offense.calls.length > 0 && (
              <Section title="WHAT THEY CALL" note="by kind of play">
                <BucketRows buckets={offense.calls.slice(0, 8)} onShow={show} />
              </Section>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

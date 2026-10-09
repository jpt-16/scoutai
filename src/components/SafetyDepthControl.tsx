"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  clampSafetyDepth,
  COVERAGE_STYLES,
  MAX_SAFETY_DEPTH,
  MIN_SAFETY_DEPTH,
  SAFETY_DEPTH_PRESETS,
  type CoverageStyle,
  type DefensiveAlignment,
} from "@/lib/defensiveAligner";
import { cn } from "@/lib/utils";

/**
 * One safety's depth as a number a coach types (yards off the line). Empty means
 * "no number of his own": he follows the preset / slider, else the rules.
 */
function DepthBox({
  label,
  name,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  name: string;
  value: number | undefined;
  placeholder: number;
  onChange: (yards: number | undefined) => void;
}) {
  // Typed text is kept as typed ("1" on the way to "12") and committed when it's a depth.
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="flex h-11 items-center gap-2 rounded-[10px] border px-2.5 text-sm font-semibold">
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-bold">{label}</span>
        <span className="text-[11px] text-muted-foreground">{name}</span>
      </span>
      <input
        type="number"
        inputMode="decimal"
        min={MIN_SAFETY_DEPTH}
        max={MAX_SAFETY_DEPTH}
        step={0.5}
        aria-label={`${name} depth in yards`}
        placeholder={String(placeholder)}
        value={text ?? (value ?? "")}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          if (t.trim() === "") return onChange(undefined);
          const n = Number(t);
          if (Number.isFinite(n) && n >= MIN_SAFETY_DEPTH) onChange(clampSafetyDepth(n));
        }}
        onBlur={() => setText(null)}
        className="h-9 w-16 rounded-md border-2 border-input bg-background px-2 text-center text-base font-bold tabular-nums outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <span className="text-xs text-muted-foreground">yds</span>
    </label>
  );
}

const chip = (selected: boolean) =>
  cn(
    "flex h-11 shrink-0 flex-col items-start justify-center rounded-[10px] border px-3 text-left leading-tight transition-colors",
    "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
    selected ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent",
  );

/**
 * Scout D toolbar strip (shown with Adjust X's): this play's safety depth
 * (presets or a slider, in yards off the line) and how the slots are played.
 * FS (free) and SS (rover) keep their spot across the field; only their depth changes,
 * and each can have a number of his own typed in.
 */
export function SafetyDepthControl({
  value,
  autoStyle,
  drawnDepths,
  onChange,
}: {
  value: DefensiveAlignment | undefined;
  /** The style the card's COVERAGE tag implies, used while the play has none of its own. */
  autoStyle: CoverageStyle;
  /** Where each safety is drawn now, in yards, for the slider and the number boxes while on auto. */
  drawnDepths: { FS: number; SS: number };
  onChange: (next: DefensiveAlignment | undefined) => void;
}) {
  const depth = value?.safetyDepthY;
  const style = value?.coverageStyle ?? autoStyle;
  const drawnDepth = Math.max(drawnDepths.FS, drawnDepths.SS);
  const set = (change: DefensiveAlignment) => {
    const next = { ...value, ...change };
    for (const key of ["safetyDepthY", "freeDepthY", "roverDepthY", "coverageStyle"] as const) {
      if (next[key] == null) delete next[key];
    }
    onChange(Object.keys(next).length === 0 ? undefined : next);
  };
  /** A preset or the slider sets both safeties, so it clears their own numbers. */
  const setBoth = (yards: number) => set({ safetyDepthY: yards, freeDepthY: undefined, roverDepthY: undefined });
  const sub = (selected: boolean) =>
    cn("text-[11px] font-semibold whitespace-nowrap", selected ? "text-primary-foreground/75" : "text-muted-foreground");

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2 sm:px-6">
      <div role="group" aria-label="Safety depth" className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-bold tracking-[0.12em] text-muted-foreground">SAFETIES</span>
        {SAFETY_DEPTH_PRESETS.map((p) => {
          const selected = depth === p.yards;
          return (
            <button
              key={p.label}
              type="button"
              aria-pressed={selected}
              className={chip(selected)}
              onClick={() => setBoth(p.yards)}
            >
              <span className="text-sm font-bold whitespace-nowrap">{p.label}</span>
              <span className={sub(selected)}>{p.range}</span>
            </button>
          );
        })}
        <label className="ml-1 flex h-11 items-center gap-2 text-sm font-semibold">
          <input
            type="range"
            min={MIN_SAFETY_DEPTH}
            max={MAX_SAFETY_DEPTH}
            step={0.5}
            value={depth ?? drawnDepth}
            aria-label="Safety depth in yards"
            onChange={(e) => setBoth(clampSafetyDepth(Number(e.target.value)))}
            className="h-11 w-36 accent-[var(--primary)]"
          />
          <span className="flex w-20 flex-col leading-tight">
            <span className="tabular-nums">{depth ?? drawnDepth} yds</span>
            <span className="text-[11px] text-muted-foreground">{depth == null ? "auto" : "both"}</span>
          </span>
        </label>
      </div>
      <div role="group" aria-label="Each safety's depth" className="flex flex-wrap items-center gap-1.5">
        <DepthBox
          label="FREE"
          name="Free safety (FS)"
          value={value?.freeDepthY}
          placeholder={value?.safetyDepthY ?? drawnDepths.FS}
          onChange={(yards) => set({ freeDepthY: yards })}
        />
        <DepthBox
          label="ROVER"
          name="Rover (SS)"
          value={value?.roverDepthY}
          placeholder={value?.safetyDepthY ?? drawnDepths.SS}
          onChange={(yards) => set({ roverDepthY: yards })}
        />
      </div>
      <span className="hidden h-7 w-px bg-border sm:block" aria-hidden="true" />
      <div role="group" aria-label="How the slots are played" className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-bold tracking-[0.12em] text-muted-foreground">SLOTS</span>
        {COVERAGE_STYLES.map((s) => {
          const selected = style === s.value;
          return (
            <button
              key={s.value}
              type="button"
              aria-pressed={selected}
              title={s.detail}
              className={chip(selected)}
              onClick={() => set({ coverageStyle: s.value })}
            >
              <span className="text-sm font-bold whitespace-nowrap">{s.label}</span>
              <span className={sub(selected)}>
                {value?.coverageStyle == null && selected ? "from coverage" : s.detail.split(",")[0]}
              </span>
            </button>
          );
        })}
      </div>
      {value && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="flex h-11 items-center gap-1.5 rounded-[10px] px-3 text-sm font-semibold text-muted-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Auto
        </button>
      )}
    </div>
  );
}

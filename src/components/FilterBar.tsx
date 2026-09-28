"use client";

import { cn } from "@/lib/utils";

export interface FilterOption<T extends string | number> {
  value: T;
  label: string;
  count: number;
}

interface FilterGroupProps<T extends string | number> {
  label: string;
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** A row of large toggle pills (44px+ touch targets) for one filter. */
export function FilterGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: FilterGroupProps<T>) {
  return (
    <div role="group" aria-label={`Filter by ${label.toLowerCase()}`} className="flex items-center gap-3">
      <span className="text-xs font-bold tracking-[0.12em] text-muted-foreground">{label}</span>
      <div className="flex gap-1.5">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              aria-pressed={selected}
              disabled={option.count === 0 && !selected}
              onClick={() => onChange(option.value)}
              className={cn(
                "flex h-11 min-w-[52px] items-center justify-center gap-1.5 rounded-[10px] border px-3.5 text-base font-bold whitespace-nowrap transition-colors",
                "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-35",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-transparent text-foreground hover:bg-accent",
              )}
            >
              {option.label}
              <span
                className={cn(
                  "text-xs font-semibold tabular-nums",
                  selected ? "text-primary-foreground/75" : "text-muted-foreground",
                )}
              >
                {option.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

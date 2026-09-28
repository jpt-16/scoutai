"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImportNoticeProps {
  /** "Loaded 33 plays" / "Added 12 plays". */
  heading: string;
  /** File name(s) the plays came from. */
  detail: string;
  warnings: string[];
  /** Bump to show the notice again (e.g. after adding a film on this page). */
  trigger?: number;
}

/** How long a clean import's confirmation stays up. Notices with warnings stay until dismissed. */
const AUTO_DISMISS_MS = 6000;

/**
 * Non-blocking confirmation shown on /script right after an upload
 * (`/script?loaded=1`). Parse warnings are tucked behind a toggle so the
 * cards stay usable. The query flag is removed so a reload doesn't re-show it.
 */
export function ImportNotice({ heading, detail, warnings, trigger = 0 }: ImportNoticeProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("loaded") !== "1") return;
    setOpen(true);
    params.delete("loaded");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);

  useEffect(() => {
    if (trigger > 0) {
      setOpen(true);
      setExpanded(false);
    }
  }, [trigger]);

  useEffect(() => {
    if (!open || warnings.length > 0) return;
    const timer = window.setTimeout(() => setOpen(false), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [open, warnings.length]);

  if (!open) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed top-[140px] right-4 z-40 w-[min(346px,calc(100vw-2rem))] sm:right-6 rounded-xl border-2 border-input bg-popover p-3 shadow-xl"
    >
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-bold">
            {heading}
          </p>
          <p className="truncate text-sm text-muted-foreground">{detail}</p>
          {warnings.length > 0 && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-primary"
            >
              <AlertTriangle className="size-4" aria-hidden="true" />
              {warnings.length} {warnings.length === 1 ? "note" : "notes"} from the file
              <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
            </button>
          )}
          {expanded && (
            <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto text-sm">
              {warnings.map((w) => (
                <li key={w} className="text-muted-foreground">
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Dismiss"
          className="-m-1 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
        >
          <X className="size-5" />
        </button>
      </div>
    </div>
  );
}

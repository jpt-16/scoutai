"use client";

import { useState } from "react";
import Link from "next/link";
import { LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SAFETY_DEPTH_PRESETS } from "@/lib/defensiveAligner";
import type { HudlPlayCard } from "@/lib/hudlParser";
import { cn } from "@/lib/utils";

const inputClass =
  "h-11 w-full rounded-lg border-2 border-input bg-background px-3 text-base font-semibold uppercase outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

const FIELDS = [
  { key: "playName", label: "PLAY CALL", placeholder: "DEUCES MESH RAIL", required: true },
  { key: "formation", label: "FORMATION", placeholder: "DEUCES" },
  { key: "defensiveCall", label: "DEFENSIVE CALL (OPTIONAL)", placeholder: "COVER 3" },
] as const;

type Form = Record<(typeof FIELDS)[number]["key"], string>;

/**
 * Type a play call, get a card: posts to /api/generate-scout-card and hands
 * the finished card back, with its AI routes draggable and its defenders
 * movable with Adjust X's, like any other card.
 */
export function GenerateCardDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (card: HudlPlayCard) => void;
}) {
  const [form, setForm] = useState<Form>({ playName: "", formation: "", defensiveCall: "" });
  const [safetyDepth, setSafetyDepth] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; account: boolean } | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-scout-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ...(safetyDepth != null ? { safetyDepth } : {}) }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        card?: HudlPlayCard;
        error?: string;
        message?: string;
      };
      if (!res.ok || !payload.card) {
        setError({
          message: payload.message ?? payload.error ?? "Couldn't draw that play. Try again.",
          account: res.status === 401 || res.status === 402 || res.status === 403,
        });
        return;
      }
      onCreate(payload.card);
      setForm({ playName: "", formation: "", defensiveCall: "" });
    } catch {
      setError({
        message: "No connection. AI cards need the internet; everything else works offline.",
        account: false,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-bold">Draw a play with AI</DialogTitle>
          <DialogDescription className="text-base">
            Type the call. The card comes back with routes and defenders you can drag into place.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.playName.trim() && !busy) void generate();
          }}
        >
          {FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <label
                htmlFor={`gen-${f.key}`}
                className="text-xs font-bold tracking-[0.12em] text-muted-foreground"
              >
                {f.label}
              </label>
              <input
                id={`gen-${f.key}`}
                className={inputClass}
                value={form[f.key]}
                placeholder={f.placeholder}
                maxLength={80}
                required={"required" in f}
                autoComplete="off"
                onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value.toUpperCase() }))}
              />
            </div>
          ))}
          <div role="group" aria-labelledby="gen-safety" className="flex flex-col gap-1.5">
            <span id="gen-safety" className="text-xs font-bold tracking-[0.12em] text-muted-foreground">
              SAFETY DEPTH
            </span>
            <div className="flex flex-wrap gap-1.5">
              {[{ label: "Auto", yards: null, range: "per coverage" }, ...SAFETY_DEPTH_PRESETS].map((p) => {
                const selected = safetyDepth === p.yards;
                return (
                  <button
                    key={p.label}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSafetyDepth(p.yards)}
                    className={cn(
                      "flex h-11 flex-col items-start justify-center rounded-[10px] border px-3 text-left leading-tight transition-colors",
                      "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                      selected ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent",
                    )}
                  >
                    <span className="text-sm font-bold">{p.label}</span>
                    <span
                      className={cn(
                        "text-[11px] font-semibold",
                        selected ? "text-primary-foreground/75" : "text-muted-foreground",
                      )}
                    >
                      {p.range}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm"
            >
              {error.message}
              {error.account && (
                <>
                  {" "}
                  <Link href="/#ai-film" className="font-semibold text-primary underline underline-offset-2">
                    Sign in or subscribe
                  </Link>
                </>
              )}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" size="lg" disabled={busy || !form.playName.trim()}>
              {busy ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles aria-hidden="true" />
              )}
              {busy ? "Drawing…" : "Draw the card"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

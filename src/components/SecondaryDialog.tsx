"use client";

import { useMemo, useRef, useState } from "react";
import { Film, LoaderCircle, RotateCcw } from "lucide-react";
import { ScoutCard } from "@/components/ScoutCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FORMATION_LABELS, type DiagramMode } from "@/lib/formations";
import type { FormationKey, HudlPlayCard } from "@/lib/hudlParser";
import {
  DB_ANCHORS,
  DB_SHADES,
  DB_SLOT_LABELS,
  DB_SLOTS,
  defaultAlignment,
  MAX_DB_DEPTH,
  parseSecondaryText,
  type DbAlignment,
  type DbAlignments,
  type DbSide,
  type DbSlot,
  type DbSpot,
} from "@/lib/secondary";
import { cn } from "@/lib/utils";

const inputClass =
  "h-11 w-full rounded-lg border-2 border-input bg-background px-3 text-base font-semibold outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

const MAX_CLIP_BYTES = 75 * 1024 * 1024;

/**
 * Scout D secondary per formation (src/lib/secondary.ts): type it, or read it
 * off a pre-snap clip with the AI, then fine-tune the table. Every Scout D card
 * in that formation draws its corners and safeties from it.
 */
export function SecondaryDialog({
  open,
  onOpenChange,
  cards,
  initialFormation,
  alignments,
  mode,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The script's cards, for the formation list and a preview card of each. */
  cards: HudlPlayCard[];
  initialFormation: FormationKey;
  alignments: DbAlignments;
  mode: DiagramMode;
  onSave: (formation: FormationKey, alignment: DbAlignment | null) => void;
}) {
  const formations = useMemo(() => {
    const keys = [...new Set(cards.map((c) => c.formationKey))].filter((k) => k !== "unknown");
    return keys.length ? keys : (["spread"] as FormationKey[]);
  }, [cards]);
  const [formation, setFormation] = useState<FormationKey>(
    formations.includes(initialFormation) ? initialFormation : formations[0],
  );
  const [drafts, setDrafts] = useState<DbAlignments>(alignments);
  const draft: DbAlignment = drafts[formation] ?? defaultAlignment();
  const [text, setText] = useState("");
  const [unread, setUnread] = useState<string[]>([]);
  const [filmBusy, setFilmBusy] = useState(false);
  const [filmMessage, setFilmMessage] = useState<{ text: string; error: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const setDraft = (next: DbAlignment) => setDrafts((d) => ({ ...d, [formation]: next }));
  const setSpot = (slot: DbSlot, change: Partial<DbSpot>) =>
    setDraft({ ...draft, [slot]: { ...(draft[slot] ?? defaultAlignment()[slot]), ...change }, source: "coach" });

  const preview = useMemo(() => {
    const sample = cards.find((c) => c.formationKey === formation) ?? cards[0];
    return sample ? { ...sample, secondary: draft, defenseOverrides: undefined } : null;
  }, [cards, formation, draft]);

  const applyText = () => {
    const { alignment, unread: missed } = parseSecondaryText(text, draft);
    setDraft(alignment);
    setUnread(missed);
  };

  const readFilm = async (file: File) => {
    if (file.size > MAX_CLIP_BYTES) {
      setFilmMessage({ text: "That clip is too big. One play, 10-20 seconds, is plenty.", error: true });
      return;
    }
    setFilmBusy(true);
    setFilmMessage({ text: "Uploading the clip…", error: false });
    try {
      const { upload } = await import("@vercel/blob/client");
      const blob = await upload(file.name, file, { access: "private", handleUploadUrl: "/api/blob-upload" });
      setFilmMessage({ text: "Reading the secondary…", error: false });
      const res = await fetch("/api/read-secondary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: blob.url }),
      });
      const payload = (await res.json()) as {
        alignment?: DbAlignment;
        formation?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !payload.alignment) {
        setFilmMessage({ text: payload.message ?? payload.error ?? "The AI couldn't read that clip.", error: true });
        return;
      }
      setDraft({ ...defaultAlignment(), ...payload.alignment });
      setFilmMessage({
        text: `Read from film${payload.formation ? ` (the AI saw ${payload.formation})` : ""}. Check the depths, then save.`,
        error: false,
      });
    } catch {
      setFilmMessage({ text: "Couldn't upload or read that clip. Try again.", error: true });
    } finally {
      setFilmBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-bold">Secondary</DialogTitle>
          <DialogDescription className="text-base">
            Where their corners and safeties line up against each formation. Every Scout D card in that
            formation uses it.
          </DialogDescription>
        </DialogHeader>

        <div role="group" aria-label="Formation" className="flex flex-wrap gap-1.5">
          {formations.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={formation === key}
              onClick={() => {
                setFormation(key);
                setUnread([]);
                setFilmMessage(null);
              }}
              className={cn(
                "flex h-11 items-center gap-1.5 rounded-[10px] border px-4 text-base font-bold transition-colors",
                "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                formation === key ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent",
              )}
            >
              vs {FORMATION_LABELS[key]}
              {drafts[key] && <span className="text-xs opacity-75">set</span>}
            </button>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="db-text" className="text-xs font-bold tracking-[0.12em] text-muted-foreground">
                TYPE IT
              </label>
              <div className="flex gap-2">
                <input
                  id="db-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyText()}
                  placeholder="FS 12 middle, SS 8 #3, corners 7 outside"
                  className={inputClass}
                />
                <Button size="lg" variant="outline" onClick={applyText} disabled={!text.trim()}>
                  Apply
                </Button>
              </div>
              {unread.length > 0 && (
                <p className="text-sm text-amber-400">Couldn&apos;t read: {unread.join(", ")}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg" variant="outline" disabled={filmBusy} onClick={() => fileInput.current?.click()}>
                {filmBusy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Film aria-hidden="true" />}
                Read it from film
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="video/mp4,video/quicktime,video/x-m4v"
                className="sr-only"
                aria-label="Pre-snap clip for the secondary"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void readFilm(file);
                }}
              />
              {filmMessage && (
                <p className={cn("min-w-0 flex-1 text-sm", filmMessage.error ? "text-destructive" : "text-muted-foreground")}>
                  {filmMessage.text}
                </p>
              )}
            </div>

            <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
              <div className="hidden grid-cols-[120px_78px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 px-3 py-2 text-[11px] font-bold tracking-[0.12em] text-muted-foreground sm:grid">
                <span>DB</span>
                <span>DEPTH</span>
                <span>OVER</span>
                <span>SHADE</span>
                <span>SIDE</span>
              </div>
              {DB_SLOTS.map((slot) => {
                const spot = draft[slot] ?? defaultAlignment()[slot];
                const safety = slot === "fs" || slot === "ss";
                return (
                  <div key={slot} className="grid grid-cols-[minmax(0,1fr)_78px] items-center gap-2 px-3 py-2.5 sm:grid-cols-[120px_78px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                    <span className="text-sm font-bold">{DB_SLOT_LABELS[slot]}</span>
                    <label className="flex items-center gap-1 text-sm text-muted-foreground">
                      <input
                        type="number"
                        min={0}
                        max={MAX_DB_DEPTH}
                        step={0.5}
                        aria-label={`${DB_SLOT_LABELS[slot]} depth in yards`}
                        value={spot.depth}
                        onChange={(e) => setSpot(slot, { depth: Number(e.target.value) })}
                        className={cn(inputClass, "h-10 w-14 px-2 text-center")}
                      />
                      yds
                    </label>
                    <select
                      aria-label={`${DB_SLOT_LABELS[slot]} over`}
                      value={spot.anchor}
                      onChange={(e) => setSpot(slot, { anchor: e.target.value as DbSpot["anchor"] })}
                      className={cn(inputClass, "h-10 text-sm")}
                    >
                      {DB_ANCHORS.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`${DB_SLOT_LABELS[slot]} shade`}
                      value={spot.shade}
                      onChange={(e) => setSpot(slot, { shade: e.target.value as DbSpot["shade"] })}
                      className={cn(inputClass, "h-10 text-sm")}
                    >
                      {DB_SHADES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.value === "head-up" ? "Head up" : s.value === "inside" ? "In" : "Out"}
                        </option>
                      ))}
                    </select>
                    {safety ? (
                      <select
                        aria-label={`${DB_SLOT_LABELS[slot]} side`}
                        value={spot.side ?? (slot === "ss" ? "strong" : "weak")}
                        onChange={(e) => setSpot(slot, { side: e.target.value as DbSide })}
                        className={cn(inputClass, "h-10 text-sm")}
                      >
                        <option value="strong">Strong</option>
                        <option value="weak">Weak</option>
                      </select>
                    ) : (
                      <span className="hidden px-1 text-sm text-muted-foreground sm:block">
                        {slot === "cs" ? "Strong" : "Weak"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-xs font-bold tracking-[0.12em] text-muted-foreground">PREVIEW</span>
            {preview ? (
              <ScoutCard card={preview} unit="defense" mode={mode} />
            ) : (
              <p className="text-sm text-muted-foreground">Load a script to preview.</p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="lg"
            disabled={!drafts[formation]}
            onClick={() => {
              setDrafts((d) => {
                const next = { ...d };
                delete next[formation];
                return next;
              });
              onSave(formation, null);
            }}
          >
            <RotateCcw aria-hidden="true" />
            Back to default
          </Button>
          <Button size="lg" onClick={() => onSave(formation, draft)}>
            Save for {FORMATION_LABELS[formation]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

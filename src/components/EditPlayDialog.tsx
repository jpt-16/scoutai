"use client";

import { useState } from "react";
import { Copy, Trash2 } from "lucide-react";
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
import { buildDiagram, ROUTE_CHOICES, type DiagramMode, type ScoutUnit } from "@/lib/formations";
import { updateCard, type CardEdits, type Hash, type HudlPlayCard } from "@/lib/hudlParser";
import { cn } from "@/lib/utils";

const FORMATION_PICKS = ["SPREAD", "TRIPS", "DUCES", "I-FORM", "PRO", "SPLIT PRO", "DOUBLE EAGLE"];
const PLAY_PICKS = [
  "IZ",
  "OZ",
  "POWER",
  "COUNTER",
  "TREY",
  "ISO",
  "SWEEP",
  "SPEED OPTION",
  "BUBBLE",
  "RPO BUBBLE",
  "SLANT",
  "4 VERTS",
  "PA SLANT",
];
const FRONT_PICKS = ["EVEN", "ODD", "4-3", "3-4", "5-2", "BEAR"];

interface EditPlayDialogProps {
  card: HudlPlayCard;
  unit: ScoutUnit;
  mode: DiagramMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (card: HudlPlayCard) => void;
  onDuplicate: (card: HudlPlayCard) => void;
  onDelete: (card: HudlPlayCard) => void;
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-bold tracking-[0.12em] text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "h-11 w-full rounded-lg border-2 border-input bg-background px-3 text-base font-semibold uppercase outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Picks({ options, onPick }: { options: string[]; onPick: (value: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onPick(o)}
          className="h-9 rounded-md border border-border px-2.5 text-sm font-bold hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {o}
        </button>
      ))}
    </div>
  );
}

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
    <div role="group" aria-label={label} className="flex rounded-lg border-2 border-input p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-10 flex-1 rounded-md px-2 text-sm font-bold transition-colors",
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

const SIDE_OPTIONS = [
  { value: "L", label: "Left" },
  { value: "", label: "Auto" },
  { value: "R", label: "Right" },
];

/**
 * Edit one play: change its formation, play call, sides, front, coverage, or
 * add a coach's note. The card preview redraws live as you type.
 */
export function EditPlayDialog({
  card,
  unit,
  mode,
  open,
  onOpenChange,
  onSave,
  onDuplicate,
  onDelete,
}: EditPlayDialogProps) {
  const [draft, setDraft] = useState<CardEdits>({
    formation: card.formation,
    offStrength: /^(L|LT|LEFT)$/i.test(card.offStrength) ? "L" : /^(R|RT|RIGHT)$/i.test(card.offStrength) ? "R" : "",
    playCall: card.playCall,
    playDir: /^(L|LT|LEFT)$/i.test(card.playDir) ? "L" : /^(R|RT|RIGHT)$/i.test(card.playDir) ? "R" : "",
    defFront: card.defFront,
    coverage: card.coverage,
    hash: card.hash,
    notes: card.notes,
    routeOverrides: card.routeOverrides ?? {},
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (edits: CardEdits) => setDraft((d) => ({ ...d, ...edits }));
  const preview = updateCard(card, draft);
  const previewJobs = buildDiagram(preview, "team", "offense").jobs;
  const routes = draft.routeOverrides ?? {};
  /** Sets one letter's route or tag; an empty route and tag drops the override. */
  const setRoute = (letter: string, change: { route?: string; tag?: string }) => {
    const next = { ...routes[letter], ...change };
    if (!next.route) delete next.route;
    if (!next.tag) delete next.tag;
    const all = { ...routes };
    if (next.route || next.tag) all[letter] = next;
    else delete all[letter];
    set({ routeOverrides: all });
  };
  const upper = (v: string) => v.toUpperCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-bold">
            Edit play {String(card.playNumber).padStart(2, "0")}
          </DialogTitle>
          <DialogDescription className="text-base">
            {card.source ? `${card.source} · ` : ""}Changes save to this iPad and redraw the card.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="flex flex-col gap-4">
            <Field label="FORMATION" htmlFor="edit-formation">
              <input
                id="edit-formation"
                className={inputClass}
                value={draft.formation ?? ""}
                onChange={(e) => set({ formation: upper(e.target.value) })}
              />
              <Picks options={FORMATION_PICKS} onPick={(v) => set({ formation: v })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="STRENGTH">
                <Segmented
                  label="Formation strength"
                  value={draft.offStrength ?? ""}
                  options={SIDE_OPTIONS}
                  onChange={(v) => set({ offStrength: v })}
                />
              </Field>
              <Field label="HASH">
                <Segmented<"L" | "M" | "R" | "">
                  label="Hash"
                  value={draft.hash ?? ""}
                  options={[
                    { value: "L", label: "L" },
                    { value: "M", label: "M" },
                    { value: "R", label: "R" },
                    { value: "", label: "—" },
                  ]}
                  onChange={(v) => set({ hash: (v || null) as Hash | null })}
                />
              </Field>
            </div>

            <Field label="PLAY CALL" htmlFor="edit-play">
              <input
                id="edit-play"
                className={inputClass}
                value={draft.playCall ?? ""}
                onChange={(e) => set({ playCall: upper(e.target.value) })}
              />
              <Picks options={PLAY_PICKS} onPick={(v) => set({ playCall: v })} />
            </Field>
            <Field label="PLAY DIRECTION">
              <Segmented
                label="Play direction"
                value={draft.playDir ?? ""}
                options={SIDE_OPTIONS}
                onChange={(v) => set({ playDir: v })}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="DEF FRONT" htmlFor="edit-front">
                <input
                  id="edit-front"
                  className={inputClass}
                  value={draft.defFront ?? ""}
                  onChange={(e) => set({ defFront: upper(e.target.value) })}
                />
              </Field>
              <Field label="COVERAGE" htmlFor="edit-coverage">
                <input
                  id="edit-coverage"
                  className={inputClass}
                  value={draft.coverage ?? ""}
                  onChange={(e) => set({ coverage: upper(e.target.value) })}
                />
              </Field>
            </div>
            <Picks options={FRONT_PICKS} onPick={(v) => set({ defFront: v })} />

            {unit === "offense" && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold tracking-[0.12em] text-muted-foreground">
                    ROUTES (EACH LETTER)
                  </span>
                  {Object.keys(routes).length > 0 && (
                    <button
                      type="button"
                      onClick={() => set({ routeOverrides: {} })}
                      className="h-9 rounded-md px-2 text-sm font-bold text-primary hover:bg-accent"
                    >
                      Reset to play call
                    </button>
                  )}
                </div>
                {["X", "H", "Y", "Z", "F"].map((letter) => (
                  <div key={letter} className="grid grid-cols-[36px_minmax(0,1fr)_96px] items-center gap-2">
                    <span
                      className="flex size-9 items-center justify-center rounded-full border-2 border-foreground font-display text-lg font-extrabold"
                      aria-hidden="true"
                    >
                      {letter}
                    </span>
                    <select
                      aria-label={`${letter} route`}
                      className={cn(inputClass, "normal-case")}
                      value={routes[letter]?.route ?? ""}
                      onChange={(e) => setRoute(letter, { route: e.target.value })}
                    >
                      <option value="">Auto · {previewJobs[letter] ?? "—"}</option>
                      {ROUTE_CHOICES.map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.label}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`${letter} tag`}
                      placeholder="Tag"
                      maxLength={10}
                      className={inputClass}
                      value={routes[letter]?.tag ?? ""}
                      onChange={(e) => setRoute(letter, { tag: e.target.value.toUpperCase() })}
                    />
                  </div>
                ))}
              </div>
            )}

            <Field label="COACH NOTE (SHOWS ON THE CARD)" htmlFor="edit-notes">
              <textarea
                id="edit-notes"
                rows={2}
                placeholder="e.g. Z cracks the S · QB holds the mesh"
                className={cn(inputClass, "h-auto py-2 normal-case")}
                value={draft.notes ?? ""}
                onChange={(e) => set({ notes: e.target.value })}
              />
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold tracking-[0.12em] text-muted-foreground">PREVIEW</span>
            <ScoutCard card={preview} unit={unit} mode={mode} />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button
              size="lg"
              variant={confirmDelete ? "destructive" : "outline"}
              onClick={() => (confirmDelete ? onDelete(card) : setConfirmDelete(true))}
            >
              <Trash2 aria-hidden="true" />
              {confirmDelete ? "Tap again to delete" : "Delete"}
            </Button>
            <Button size="lg" variant="outline" onClick={() => onDuplicate(preview)}>
              <Copy aria-hidden="true" />
              Duplicate
            </Button>
          </div>
          <div className="flex gap-2">
            <Button size="lg" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="lg" onClick={() => onSave(preview)}>
              Save play
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { CircleHelp, FileArchive, Film, Loader2, Sparkles, Table2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MAX_BATCH_CLIPS } from "@/lib/batchConfig";
import {
  baseName,
  checklistLabel,
  planBatch,
  sortBatchFiles,
  textAiRequest,
  type BatchPlan,
  type RowRoute,
} from "@/lib/batchMatcher";
import { isClerkConfigured } from "@/lib/clerkConfig";
import { isAiGateDisabled } from "@/lib/featureFlags";
import { mapWithConcurrency } from "@/lib/concurrency";
import { parseHudlCsv, type HudlPlayCard } from "@/lib/hudlParser";
import { storeScript } from "@/lib/scriptStore";
import { useTeamAccount } from "@/lib/useTeamAccount";
import { applyDetectionToCard, type DetectedPlay } from "@/lib/videoImport";
import { cn } from "@/lib/utils";

interface BatchClipResult {
  fileName: string;
  detection?: DetectedPlay;
  error?: string;
}

/** A clip from a zip or a loose drop: its name, and how to read it when its turn comes. */
interface ClipSource {
  name: string;
  load: () => Promise<Blob>;
}

interface Picked {
  clips: ClipSource[];
  sheet: File | null;
  cards: HudlPlayCard[];
  plan: BatchPlan | null;
}

const EMPTY: Picked = { clips: [], sheet: null, cards: [], plan: null };

const ROUTE_LABELS: Record<RowRoute, { label: string; detail: string }> = {
  video: { label: "Film", detail: "routes read from the clip" },
  text: { label: "AI", detail: "drawn by the AI from the call" },
  sheet: { label: "Sheet", detail: "drawn from the sheet, instantly" },
};

/**
 * One-click game import: a Hudl "video with data" zip (clips and the
 * breakdown sheet together), or the clips and the sheet dropped loose.
 *
 * 1. Unzip in the browser (JSZip), sort clips from the sheet, read the sheet
 *    (CSV or .xlsx) with the normal parser: ground truth, never overwritten.
 * 2. Line clips up with rows (`planBatch`: PLAY #, else row order) and show
 *    the checklist before anything is spent.
 * 3. On Generate, run two queues side by side: clips go up to private Blob
 *    storage and through `/api/parse-video-batch` in chunks of
 *    `MAX_BATCH_CLIPS` (one job per game); rows with no clip that the rules
 *    can't draw go to `/api/generate-scout-card`. Everything else is already
 *    a card. A failure on any row keeps that row's sheet card.
 */
function useBatchUpload() {
  const router = useRouter();
  const [picked, setPicked] = useState<Picked>(EMPTY);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const acceptFiles = async (list: FileList | null | undefined) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setReading(true);
    setError(null);
    try {
      let clips: ClipSource[] = [...picked.clips];
      let sheet = picked.sheet;
      // A zip: everything inside it, unpacked in the browser.
      for (const zipFile of files.filter((f) => /\.zip$/i.test(f.name))) {
        const { default: JSZip } = await import("jszip");
        const zip = await JSZip.loadAsync(zipFile);
        const entries = Object.values(zip.files).filter((f) => !f.dir);
        const sorted = sortBatchFiles(entries);
        clips = [...clips, ...sorted.clips.map((e) => ({ name: baseName(e.name), load: () => e.async("blob") }))];
        if (sorted.sheets[0]) {
          const blob = await sorted.sheets[0].async("blob");
          sheet = new File([blob], baseName(sorted.sheets[0].name));
        }
      }
      // Loose files: clips and a sheet dropped together (a zip already extracted).
      const loose = sortBatchFiles(files.filter((f) => !/\.zip$/i.test(f.name)));
      clips = [...clips, ...loose.clips.map((f) => ({ name: f.name, load: async () => f as Blob }))];
      if (loose.sheets[0]) sheet = loose.sheets[0];
      // The same clip dropped twice counts once.
      clips = clips.filter((c, i) => clips.findIndex((o) => o.name === c.name) === i);

      let cards = picked.sheet === sheet ? picked.cards : [];
      if (sheet && sheet !== picked.sheet) {
        cards = (await parseHudlCsv(sheet)).cards;
        if (cards.length === 0) throw new Error(`${sheet.name} has no plays ScoutCard AI could read.`);
      }
      setPicked({
        clips,
        sheet,
        cards,
        plan: sheet ? planBatch(clips.map((c) => c.name), cards) : null,
      });
      if (!sheet && clips.length) setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read those files.");
    } finally {
      setReading(false);
    }
  };

  const clear = () => {
    setPicked(EMPTY);
    setError(null);
  };

  const processBatch = async () => {
    const { plan, sheet } = picked;
    if (!plan || !sheet) return;
    setBusy(true);
    setError(null);
    try {
      const videoRows = plan.rows.filter((r) => r.route === "video");
      const textRows = plan.rows.filter((r) => r.route === "text");
      const total = videoRows.length + textRows.length;
      let done = 0;
      const tick = () => {
        done += 1;
        setProgress({ label: `Processing play ${done} of ${total}…`, done, total });
      };
      setProgress({ label: total ? `Processing ${total} plays…` : "Building the script…", done: 0, total });

      if (videoRows.length) {
        // Refuse a game over the plan's plays-per-batch before uploading anything.
        const access = (await fetch("/api/ai-access", { cache: "no-store" })
          .then((res) => res.json())
          .catch(() => null)) as { limits?: { batch?: { maxPlays?: number } } } | null;
        const maxPlays = access?.limits?.batch?.maxPlays;
        if (maxPlays && videoRows.length > maxPlays) {
          throw new Error(
            `This game has ${videoRows.length} clips; a batch can have at most ${maxPlays}. Split it into two uploads.`,
          );
        }
      }

      const updated = new Map<string, HudlPlayCard>();
      let failed = 0;

      // Film queue: chunks through the batch route, one job per game.
      const filmQueue = async () => {
        const jobId = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        const clipByName = new Map(picked.clips.map((c) => [c.name, c]));
        for (let start = 0; start < videoRows.length; start += MAX_BATCH_CLIPS) {
          const chunk = videoRows.slice(start, start + MAX_BATCH_CLIPS);
          const uploaded = await mapWithConcurrency(chunk, 3, async (row) => {
            const source = clipByName.get(row.clip!)!;
            const blobData = await source.load();
            const file = new File([blobData], source.name, { type: blobData.type || "video/mp4" });
            const { upload } = await import("@vercel/blob/client");
            // Private: opposing-team film shouldn't sit at a plain fetchable URL.
            const blob = await upload(file.name, file, { access: "private", handleUploadUrl: "/api/blob-upload" });
            return { videoUrl: blob.url, fileName: source.name, row };
          });
          const res = await fetch("/api/parse-video-batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clips: uploaded.map(({ videoUrl, fileName, row }) => ({ videoUrl, fileName, playCall: row.card.playCall })),
              jobId,
              totalPlays: videoRows.length,
              final: start + MAX_BATCH_CLIPS >= videoRows.length,
            }),
          });
          const payload = (await res.json().catch(() => ({}))) as { results?: BatchClipResult[]; error?: string };
          if (!res.ok || !payload.results) throw new Error(payload.error ?? "The film couldn't be processed.");
          payload.results.forEach((result, i) => {
            const { row } = uploaded[i];
            if (result.detection) updated.set(row.card.id, applyDetectionToCard(row.card, result.detection));
            else failed += 1;
            tick();
          });
        }
      };

      // Text queue: the AI draws the rows the sheet can't, two at a time.
      const textQueue = () =>
        mapWithConcurrency(textRows, 2, async (row) => {
          try {
            const res = await fetch("/api/generate-scout-card", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(textAiRequest(row.card)),
            });
            const payload = (await res.json().catch(() => ({}))) as { card?: HudlPlayCard };
            if (res.ok && payload.card) {
              updated.set(row.card.id, {
                ...row.card,
                routeOverrides: payload.card.routeOverrides,
                defenseOverrides: payload.card.defenseOverrides,
                // Drawn already: the import review needn't send it again.
                aiReviewed: true,
              });
            } else failed += 1;
          } catch {
            failed += 1;
          }
          tick();
        });

      await Promise.all([filmQueue(), textQueue()]);

      const cards = plan.rows.map((r) => updated.get(r.card.id) ?? r.card);
      const warnings: string[] = [];
      if (plan.counts.video) {
        warnings.push("Film routes are a rough starting point: drag a route's break points on the card to fix it.");
      }
      if (plan.unmatchedClips.length) {
        warnings.push(
          `${plan.unmatchedClips.length} clip${plan.unmatchedClips.length === 1 ? "" : "s"} matched no play and ${
            plan.unmatchedClips.length === 1 ? "was" : "were"
          } skipped: ${plan.unmatchedClips.slice(0, 5).map(baseName).join(", ")}${plan.unmatchedClips.length > 5 ? "…" : ""}`,
        );
      }
      if (failed) {
        warnings.push(`${failed} play${failed === 1 ? "" : "s"} couldn't be read by the AI and kept the sheet's card.`);
      }
      storeScript({ fileName: "", films: [sheet.name], savedAt: "", cards, warnings });
      router.push("/script?loaded=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't process that game. Try again.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return { picked, reading, busy, error, progress, input, acceptFiles, processBatch, clear };
}

interface BatchUploaderProps {
  /** Whether to render at all — the caller (real vs. testing vs. unconfigured) decides gating. */
  canUpload: boolean;
  /** Called instead of processing when `canUpload` is false (sign in / create team / subscribe). */
  onGate?: () => void;
}

function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const steps = [
    {
      title: "Download it from Hudl",
      body: "Open the opponent's playlist in Hudl, click Download, and choose Download Video with Data. You get one .zip with every clip and the breakdown sheet.",
    },
    {
      title: "Drop the .zip here",
      body: "Drag the single downloaded .zip straight in; it's unpacked on your device. Already unzipped it? Drop all the clips and the .csv or .xlsx together instead.",
    },
    {
      title: "Click Generate Scout Cards",
      body: "Check the list of matched plays, then generate. Clips get their routes read from film; the rest draw from the sheet, and your whole script builds on its own.",
    },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-bold">
            How to Import Full Game Film in 30 Seconds
          </DialogTitle>
          <DialogDescription className="text-base">Three steps, one file.</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-4">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-display text-xl font-extrabold text-primary-foreground">
                {i + 1}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="font-bold">{step.title}</span>
                <span className="text-sm text-muted-foreground">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">
          Hudl&apos;s menu wording varies by version. Clips are matched by the number in their name
          (clip_01.mp4, Play 4.mp4) to the sheet&apos;s PLAY # column, or to row order.
        </p>
        <DialogFooter>
          <Button size="lg" onClick={() => onOpenChange(false)}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchUploaderCard({ canUpload, onGate }: BatchUploaderProps) {
  const { picked, reading, busy, error, progress, input, acceptFiles, processBatch, clear } = useBatchUpload();
  const [dragging, setDragging] = useState(false);
  const [help, setHelp] = useState(false);
  const plan = picked.plan;
  const hasFiles = picked.clips.length > 0 || picked.sheet;

  const handleGenerate = () => {
    if (!canUpload) {
      onGate?.();
      return;
    }
    void processBatch();
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!busy) void acceptFiles(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col gap-3 rounded-xl border-2 border-dashed p-4 transition-colors",
        dragging ? "border-primary bg-muted" : "border-input",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <FileArchive className="size-5 text-primary" aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="font-bold">Full game film: one click</p>
          <p className="text-sm text-muted-foreground">
            Drop Hudl&apos;s &ldquo;video with data&rdquo; .zip, or the clips and the breakdown sheet together.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setHelp(true)} className="shrink-0">
          <CircleHelp aria-hidden="true" />
          How it works
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={busy || reading}>
          {reading && <Loader2 className="animate-spin" aria-hidden="true" />}
          {reading ? "Reading…" : hasFiles ? "Add files" : "Choose .zip or files"}
        </Button>
        {hasFiles && !busy && (
          <Button variant="ghost" size="sm" onClick={clear}>
            <X aria-hidden="true" />
            Clear
          </Button>
        )}
        <span className="text-sm text-muted-foreground">
          {picked.clips.length} {picked.clips.length === 1 ? "clip" : "clips"} ·{" "}
          {picked.sheet ? picked.sheet.name : "no sheet yet"}
        </span>
      </div>

      {plan && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5 text-xs font-bold">
            {(Object.keys(ROUTE_LABELS) as RowRoute[]).map((route) => (
              <span key={route} className="rounded-full border px-2.5 py-1" title={ROUTE_LABELS[route].detail}>
                {plan.counts[route]} {ROUTE_LABELS[route].label.toLowerCase()}
              </span>
            ))}
            {plan.unmatchedClips.length > 0 && (
              <span className="rounded-full border border-amber-500/50 px-2.5 py-1 text-amber-400">
                {plan.unmatchedClips.length} clip{plan.unmatchedClips.length === 1 ? "" : "s"} unmatched
              </span>
            )}
            <span className="px-1 py-1 font-semibold text-muted-foreground">
              matched by {plan.matchedBy === "play-number" ? "PLAY #" : "row order"}
            </span>
          </div>
          <ul aria-label="Matched plays" className="max-h-64 overflow-y-auto rounded-lg border bg-card text-sm">
            {plan.rows.map((row) => (
              <li key={row.card.id} className="flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0">
                {row.route === "video" ? (
                  <Film className="size-4 shrink-0 text-emerald-400" aria-label="Film" />
                ) : row.route === "text" ? (
                  <Sparkles className="size-4 shrink-0 text-primary" aria-label="AI" />
                ) : (
                  <Table2 className="size-4 shrink-0 text-muted-foreground" aria-label="Sheet" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {row.route === "video" ? "✓ " : ""}
                  {checklistLabel(row)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{ROUTE_LABELS[row.route].label}</span>
              </li>
            ))}
            {plan.unmatchedClips.map((name) => (
              <li key={name} className="flex items-center gap-2 border-b px-3 py-1.5 text-amber-400 last:border-b-0">
                <Film className="size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{baseName(name)}: no matching play, skipped</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!plan && picked.clips.length > 0 && (
        <p className="text-sm text-amber-400">Add the breakdown sheet (.csv or .xlsx) to match these clips.</p>
      )}

      {plan && (
        <Button size="lg" onClick={handleGenerate} disabled={busy} className="self-start">
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
          {busy ? "Generating…" : canUpload ? "Generate Scout Cards" : "Sign in to generate"}
        </Button>
      )}

      {progress && (
        <div className="flex flex-col gap-1.5" role="status">
          <div className="h-2.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 100}%` }}
            />
          </div>
          <p className="text-sm font-semibold text-primary">{progress.label}</p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}

      <input
        ref={input}
        type="file"
        multiple
        accept=".zip,.csv,.xlsx,.mp4,.mov,.m4v,video/*,text/csv"
        className="sr-only"
        aria-label="Game zip, or clips and a breakdown sheet"
        onChange={(e) => {
          void acceptFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <HelpDialog open={help} onOpenChange={setHelp} />
    </div>
  );
}

/**
 * A paid, per-coaching-staff feature — same gate as `VideoUploadCard`
 * (Clerk sign-in, an active organization, a subscription), meant to sit
 * alongside it. Renders nothing when Clerk isn't configured yet, since the
 * single-clip card already explains the feature is coming soon; no need to
 * repeat that twice. `isAiGateDisabled()` (local-only testing flag, see
 * `src/lib/featureFlags.ts`) skips the gate entirely, same as the
 * single-clip card.
 */
export function BatchUploader() {
  if (isAiGateDisabled()) {
    return (
      <Card className="gap-0 rounded-2xl border-2 border-dashed border-primary/40 bg-transparent py-4">
        <CardContent className="px-4">
          <Badge className="mb-3 h-5 rounded-full bg-primary/20 px-2 text-[11px] font-extrabold tracking-[0.08em] text-primary">
            BATCH
          </Badge>
          <BatchUploaderCard canUpload />
        </CardContent>
      </Card>
    );
  }

  if (!isClerkConfigured()) {
    return null;
  }

  return <BatchUploaderInner />;
}

function BatchUploaderInner() {
  const clerk = useClerk();
  const account = useTeamAccount();
  const [subscribing, setSubscribing] = useState(false);

  const handleSubscribe = async () => {
    setSubscribing(true);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const payload = await res.json();
      if (res.ok && payload.url) {
        window.location.href = payload.url;
        return;
      }
    } catch {
      // Fall through — button re-enables.
    }
    setSubscribing(false);
  };

  const handleGate = () => {
    if (account.loading || subscribing || account.entitled) return;
    if (!account.userId) {
      clerk.openSignIn();
      return;
    }
    if (!account.team) {
      clerk.openCreateOrganization();
      return;
    }
    if (!account.entitled) {
      void handleSubscribe();
    }
  };

  return (
    <Card className="gap-0 rounded-2xl border-2 border-dashed border-primary/40 bg-transparent py-4">
      <CardContent className="px-4">
        <Badge className="mb-3 h-5 rounded-full bg-primary/20 px-2 text-[11px] font-extrabold tracking-[0.08em] text-primary">
          BATCH
        </Badge>
        <BatchUploaderCard canUpload={account.entitled} onGate={handleGate} />
      </CardContent>
    </Card>
  );
}

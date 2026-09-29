"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import JSZip from "jszip";
import { FileArchive, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MAX_BATCH_CLIPS } from "@/lib/batchConfig";
import { isClerkConfigured } from "@/lib/clerkConfig";
import { isAiGateDisabled } from "@/lib/featureFlags";
import { mapWithConcurrency } from "@/lib/concurrency";
import { matchClipsToCards, type ClipMatch } from "@/lib/clipMatching";
import { parseHudlCsv } from "@/lib/hudlParser";
import { storeScript } from "@/lib/scriptStore";
import { useTeamAccount } from "@/lib/useTeamAccount";
import { applyDetectionToCard, type DetectedPlay } from "@/lib/videoImport";

interface BatchClipResult {
  fileName: string;
  detection?: DetectedPlay;
  error?: string;
}

interface BatchProgress {
  label: string;
  current: number;
  total: number;
}

function isCsvFile(f: File): boolean {
  return /\.csv$/i.test(f.name);
}
function isZipFile(f: File): boolean {
  return /\.zip$/i.test(f.name);
}

/**
 * Shared batch pipeline, Clerk-free — for one game script: a Hudl breakdown
 * CSV plus the zip of that game's clips Hudl exports alongside it.
 *
 * 1. Parse the CSV for real down/distance/formation/play-call data (ground
 *    truth — never overwritten by the AI).
 * 2. Extract the zip client-side with JSZip and match each clip's filename
 *    to a CSV row by its embedded play number (`clipMatching.ts`).
 * 3. Process matched clips in chunks of `MAX_BATCH_CLIPS`: upload each to
 *    private blob storage, send the chunk to `/api/parse-video-batch`, and
 *    merge each result's detected routes onto its CSV row
 *    (`applyDetectionToCard` — only the routes come from AI, everything
 *    else stays as Hudl recorded it).
 * 4. Save the merged script and open it, same as every other import path.
 */
function useBatchUpload() {
  const router = useRouter();
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);

  const acceptFiles = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? []);
    const csv = files.find(isCsvFile);
    const zip = files.find(isZipFile);
    if (csv) setCsvFile(csv);
    if (zip) setZipFile(zip);
    if (!csv && !zip && files.length > 0) {
      setError("Drop a .csv breakdown and a .zip of clips — neither of those files matched.");
    } else {
      setError(null);
    }
  };

  const processBatch = async () => {
    if (!csvFile || !zipFile) return;
    setBusy(true);
    setError(null);
    try {
      setProgress({ label: "Reading the CSV…", current: 0, total: 1 });
      const { cards: parsedCards } = await parseHudlCsv(csvFile);
      if (parsedCards.length === 0) {
        throw new Error("That CSV has no plays ScoutCard AI could read.");
      }

      setProgress({ label: "Extracting clips from the zip…", current: 0, total: 1 });
      const zip = await JSZip.loadAsync(zipFile);
      const entries = Object.values(zip.files).filter((f) => !f.dir && /\.(mp4|mov|m4v)$/i.test(f.name));
      if (entries.length === 0) {
        throw new Error("No .mp4/.mov clips found in that zip.");
      }

      const matches = matchClipsToCards(
        entries.map((f) => f.name),
        parsedCards,
      );
      const matchedEntries = entries
        .map((entry, i) => ({ entry, match: matches[i] }))
        .filter((e): e is { entry: (typeof entries)[number]; match: ClipMatch } => e.match.card !== null);
      const unmatchedCount = entries.length - matchedEntries.length;
      if (matchedEntries.length === 0) {
        throw new Error(
          'None of the zip\'s clip filenames matched a PLAY # in the CSV. Rename clips to include the ' +
            'play number (e.g. "Play_4.mp4") and make sure the CSV and zip are from the same game.',
        );
      }

      const total = matchedEntries.length;
      let cards = parsedCards;
      let done = 0;
      let failedCount = 0;

      for (let start = 0; start < matchedEntries.length; start += MAX_BATCH_CLIPS) {
        const chunk = matchedEntries.slice(start, start + MAX_BATCH_CLIPS);

        const uploaded = await mapWithConcurrency(chunk, 3, async ({ entry, match }) => {
          setProgress({ label: `Uploading ${match.fileName}…`, current: done, total });
          const blobData = await entry.async("blob");
          const file = new File([blobData], match.fileName, { type: blobData.type || "video/mp4" });
          const { upload } = await import("@vercel/blob/client");
          // Private: opposing-team film shouldn't sit at a plain fetchable URL.
          const blob = await upload(file.name, file, { access: "private", handleUploadUrl: "/api/blob-upload" });
          return { videoUrl: blob.url, fileName: match.fileName, playNumber: match.card!.playNumber };
        });

        setProgress({ label: `Analyzing plays ${done + 1}–${done + chunk.length} of ${total}…`, current: done, total });
        const res = await fetch("/api/parse-video-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clips: uploaded.map(({ videoUrl, fileName }) => ({ videoUrl, fileName })) }),
        });
        const payload = (await res.json()) as { results?: BatchClipResult[]; error?: string };
        if (!res.ok || !payload.results) {
          throw new Error(payload.error ?? "The batch could not be processed.");
        }

        payload.results.forEach((result, i) => {
          done++;
          setProgress({ label: `Processing play ${done} of ${total}…`, current: done, total });
          if (!result.detection) {
            failedCount++;
            return;
          }
          const playNumber = uploaded[i].playNumber;
          const detection = result.detection;
          cards = cards.map((c) => (c.playNumber === playNumber ? applyDetectionToCard(c, detection) : c));
        });
      }

      const warnings = [
        "AI-detected routes are a rough starting point — drag each route's break points on the card to correct them.",
      ];
      if (unmatchedCount > 0) {
        warnings.push(
          `${unmatchedCount} clip${unmatchedCount === 1 ? "" : "s"} in the zip didn't match a play number in ` +
            "the CSV and were skipped.",
        );
      }
      if (failedCount > 0) {
        warnings.push(
          `${failedCount} clip${failedCount === 1 ? "" : "s"} couldn't be analyzed and kept the CSV's data ` +
            "with no AI route.",
        );
      }

      storeScript({ fileName: "", films: [csvFile.name], savedAt: "", cards, warnings });
      router.push("/script?loaded=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't process that batch. Try again.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return { csvFile, zipFile, busy, error, progress, csvInput, zipInput, acceptFiles, processBatch };
}

interface BatchUploaderProps {
  /** Whether to render at all — the caller (real vs. testing vs. unconfigured) decides gating. */
  canUpload: boolean;
  /** Called instead of processing when `canUpload` is false (sign in / create team / subscribe). */
  onGate?: () => void;
}

function BatchUploaderCard({ canUpload, onGate }: BatchUploaderProps) {
  const { csvFile, zipFile, busy, error, progress, csvInput, zipInput, acceptFiles, processBatch } =
    useBatchUpload();
  const [dragging, setDragging] = useState(false);
  const ready = Boolean(csvFile && zipFile);

  const handleClick = () => {
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
        acceptFiles(e.dataTransfer.files);
      }}
      className={`flex flex-col gap-3 rounded-xl border-2 border-dashed p-4 transition-colors ${
        dragging ? "border-primary bg-muted" : "border-input"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <FileArchive className="size-5 text-primary" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="font-bold">Have a full game script? Batch upload</p>
          <p className="text-sm text-muted-foreground">
            Drop the Hudl breakdown CSV and its clip zip together — up to {MAX_BATCH_CLIPS} plays analyzed per
            batch, so a 50-play script takes a few batches.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Button variant="outline" size="sm" onClick={() => csvInput.current?.click()} disabled={busy}>
          {csvFile ? csvFile.name : "Choose CSV"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => zipInput.current?.click()} disabled={busy}>
          {zipFile ? zipFile.name : "Choose clip zip"}
        </Button>
        <Button size="sm" onClick={handleClick} disabled={!ready || busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
          {busy ? "Processing…" : canUpload ? "Process batch" : "Sign in to process"}
        </Button>
      </div>

      {progress && (
        <p className="text-sm font-semibold text-primary" role="status">
          {progress.label}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}

      <input
        ref={csvInput}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-label="Hudl breakdown CSV"
        onChange={(e) => {
          acceptFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={zipInput}
        type="file"
        accept=".zip"
        className="sr-only"
        aria-label="Zip of game clips"
        onChange={(e) => {
          acceptFiles(e.target.files);
          e.target.value = "";
        }}
      />
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
    if (account.loading || subscribing) return;
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

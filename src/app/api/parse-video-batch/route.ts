/**
 * Batch counterpart to `/api/parse-video`: a coach with a full game script —
 * a Hudl breakdown CSV plus a zip of that game's clips — uploads several
 * clips at once (see `src/components/BatchUploader.tsx`, which extracts the
 * zip client-side and matches each clip to its CSV row by filename before
 * calling this route). Takes `{ clips: [{videoUrl, fileName}] }`, the same
 * private-blob-URL shape `/api/parse-video` takes for one clip, uploaded
 * beforehand through the same `/api/blob-upload`.
 *
 * One game is one **job**: the client sends it as chunks of up to
 * `MAX_BATCH_CLIPS` (a serverless call has to finish in time) tagged with the
 * same `jobId`, plus `totalPlays` and `final` on the last chunk. Per tier
 * (src/lib/usageLimits.ts `batch`), a staff can run so many jobs at once and
 * each job can have so many plays; `checkBatchJob` enforces both. Clips are
 * processed with bounded concurrency so a chunk doesn't fire all its Gemini
 * calls at once. One clip failing never sinks the rest — each comes back with either
 * a `detection` or an `error`, in the same order they were sent, so the
 * caller can match results back to clips by index.
 */

import { checkRateLimit } from "@vercel/firewall";
import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { MAX_BATCH_CLIPS } from "@/lib/batchConfig";
import { mapWithConcurrency } from "@/lib/concurrency";
import { requireEntitlement } from "@/lib/entitlement";
import { isFilmImportEnabled } from "@/lib/featureFlags";
import { checkBatchJob } from "@/lib/rateLimit";
import { isValidJobId, TIER_LIMITS } from "@/lib/usageLimits";
import { detectPlayFromClip, VideoDetectionError, type DetectClipOptions } from "@/lib/videoDetection";
import type { DetectedPlay } from "@/lib/videoImport";

/** How many clips are sent to Gemini at once within one batch. */
const BATCH_CONCURRENCY = 4;

export const runtime = "nodejs";
// Several clips processed with bounded concurrency can take a while even at
// BATCH_CONCURRENCY. Raise this if your Vercel plan allows it (Hobby caps
// function duration much lower than Pro) — confirm the actual current limit
// for your plan rather than trusting this number.
export const maxDuration = 300;

interface RequestClip {
  videoUrl?: string;
  fileName?: string;
  /** The matched CSV row's play call, so the prompt can apply that concept's route rules. */
  playCall?: string;
}

interface RequestBody {
  clips?: RequestClip[];
  /** Same for every chunk of one game. */
  jobId?: unknown;
  /** Plays in the whole game, so an over-limit game is refused before it starts. */
  totalPlays?: unknown;
  /** True on the game's last chunk, which frees its job slot right away. */
  final?: unknown;
}

export interface BatchClipResult {
  fileName: string;
  detection?: DetectedPlay;
  error?: string;
}

async function processClip(options: DetectClipOptions, fileName: string): Promise<BatchClipResult> {
  try {
    const detection = await detectPlayFromClip(options);
    return { fileName, detection };
  } catch (error) {
    const message =
      error instanceof VideoDetectionError || error instanceof Error
        ? error.message
        : "Could not process this clip";
    return { fileName, error: message };
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  // Hidden unless NEXT_PUBLIC_FILM_IMPORT=true (src/lib/featureFlags.ts): the sheet draws the
  // cards, so nothing here runs, and nothing is billed, while the film import is off.
  if (!isFilmImportEnabled()) {
    return NextResponse.json({ error: "film_import_off", message: "Film import is turned off." }, { status: 404 });
  }

  // Middleware already fast-fails an unauthenticated request; this re-check
  // is authoritative for a money-costing call and is also what resolves the
  // team id used to key the rate limit below.
  const entitlement = await requireEntitlement();
  if (!entitlement.ok) {
    return NextResponse.json(
      { error: entitlement.error, message: entitlement.message },
      { status: entitlement.status },
    );
  }

  // See src/lib/rateLimit.ts: checkRateLimit is a no-op without a Firewall
  // rule this project's plan doesn't support creating; checkBatchJob (below,
  // once the body says which job this is) is the real cap.
  const { rateLimited } = await checkRateLimit("parse-video-batch", { request });
  if (rateLimited) {
    return NextResponse.json(
      { error: "Too many batches submitted recently. Wait a few minutes and try again." },
      { status: 429 },
    );
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const clips = body.clips ?? [];
  if (clips.length === 0) {
    return NextResponse.json({ error: "No clips in this batch" }, { status: 400 });
  }
  if (clips.length > MAX_BATCH_CLIPS) {
    return NextResponse.json(
      { error: `A batch can have at most ${MAX_BATCH_CLIPS} clips — split this into more than one batch.` },
      { status: 400 },
    );
  }
  const missingUrl = clips.find((c) => !c.videoUrl);
  if (missingUrl) {
    return NextResponse.json({ error: "Every clip needs a videoUrl" }, { status: 400 });
  }
  if (!isValidJobId(body.jobId)) {
    return NextResponse.json({ error: "Every chunk needs the batch's jobId" }, { status: 400 });
  }
  const totalPlays =
    typeof body.totalPlays === "number" && Number.isInteger(body.totalPlays) && body.totalPlays > 0
      ? body.totalPlays
      : clips.length;

  const job = await checkBatchJob(
    entitlement.teamId,
    { jobId: body.jobId, clips: clips.length, totalPlays, final: body.final === true },
    TIER_LIMITS[entitlement.tier].batch,
  );
  if (!job.ok) {
    return NextResponse.json({ error: job.message }, { status: 429 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Server is missing GEMINI_API_KEY" }, { status: 500 });
  }
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return NextResponse.json({ error: "Server is missing BLOB_READ_WRITE_TOKEN" }, { status: 500 });
  }

  const ai = new GoogleGenAI({ apiKey });
  const results = await mapWithConcurrency(clips, BATCH_CONCURRENCY, (clip, i) =>
    processClip(
      {
        ai,
        blobToken,
        videoUrl: clip.videoUrl!,
        playCall: typeof clip.playCall === "string" ? clip.playCall : undefined,
      },
      clip.fileName ?? `clip-${i + 1}`,
    ),
  );

  return NextResponse.json({ results });
}

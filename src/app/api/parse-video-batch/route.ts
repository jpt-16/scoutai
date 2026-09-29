/**
 * Batch counterpart to `/api/parse-video`: a coach with a full game script —
 * a Hudl breakdown CSV plus a zip of that game's clips — uploads several
 * clips at once (see `src/components/BatchUploader.tsx`, which extracts the
 * zip client-side and matches each clip to its CSV row by filename before
 * calling this route). Takes `{ clips: [{videoUrl, fileName}] }`, the same
 * private-blob-URL shape `/api/parse-video` takes for one clip, uploaded
 * beforehand through the same `/api/blob-upload`.
 *
 * Capped at `MAX_BATCH_CLIPS` per call (a deliberate product decision, not
 * just a technical limit — a 50-play script needs several batches rather
 * than one uncapped, unpredictably expensive Gemini bill) and processed
 * with bounded concurrency so it doesn't fire dozens of Gemini calls at
 * once. One clip failing never sinks the rest — each comes back with either
 * a `detection` or an `error`, in the same order they were sent, so the
 * caller can match results back to clips by index.
 */

import { checkRateLimit } from "@vercel/firewall";
import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { MAX_BATCH_CLIPS } from "@/lib/batchConfig";
import { mapWithConcurrency } from "@/lib/concurrency";
import { requireEntitlement } from "@/lib/entitlement";
import { checkBlobRateLimit } from "@/lib/rateLimit";
import { detectPlayFromClip, VideoDetectionError, type DetectClipOptions } from "@/lib/videoDetection";
import type { DetectedPlay } from "@/lib/videoImport";

// One batch (up to MAX_BATCH_CLIPS Gemini calls) per team per window — a
// separate, coarser bucket than /api/parse-video's per-clip 3/10min, since
// a single batch already bundles up to MAX_BATCH_CLIPS of those calls. A
// full 50-play script needs ~5 batches, roughly 10 minutes apart.
const PARSE_VIDEO_BATCH_RATE_LIMIT = { limit: 1, windowMs: 10 * 60 * 1000 };

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
  // rule this project's plan doesn't support creating; checkBlobRateLimit is
  // the real cap.
  const { rateLimited } = await checkRateLimit("parse-video-batch", { request });
  const { ok } = await checkBlobRateLimit(
    "parse-video-batch",
    entitlement.teamId,
    PARSE_VIDEO_BATCH_RATE_LIMIT.limit,
    PARSE_VIDEO_BATCH_RATE_LIMIT.windowMs,
  );
  if (rateLimited || !ok) {
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

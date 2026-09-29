/**
 * Sends an uploaded game clip to Gemini 2.5 Flash and returns its best guess
 * at each skill player's route. This is a rough, unverified detection —
 * see `src/lib/coordinateMapper.ts`'s doc comment — meant to be dragged into
 * shape on the card afterward, not trusted as-is.
 *
 * Takes `{ videoUrl, fileName }` (the blob URL from `/api/blob-upload`'s
 * client upload), not a file body — a real clip is well past what a Vercel
 * serverless function accepts inline in the request.
 *
 * The actual Gemini call (prompt, schema, step-by-step error handling)
 * lives in `src/lib/videoDetection.ts`, shared with `/api/parse-video-batch`
 * for the multi-clip flow.
 */

import { checkRateLimit } from "@vercel/firewall";
import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { requireEntitlement } from "@/lib/entitlement";
import { checkBlobRateLimit } from "@/lib/rateLimit";
import { detectPlayFromClip, VideoDetectionError } from "@/lib/videoDetection";

// Each Gemini call here costs real money — kept tight. checkRateLimit() only
// enforces anything once a matching Vercel Firewall rule exists (see
// src/lib/rateLimit.ts for why that isn't available on this project yet);
// checkBlobRateLimit() is what's actually enforcing this limit right now.
const PARSE_VIDEO_RATE_LIMIT = { limit: 3, windowMs: 10 * 60 * 1000 }; // 3 per 10 minutes per team

export const runtime = "nodejs";
// Vision analysis of even a short clip can take a while. Raise this if your
// Vercel plan allows it (Hobby caps function duration much lower than Pro) —
// confirm the actual current limit for your plan rather than trusting this number.
export const maxDuration = 300;

interface RequestBody {
  videoUrl?: string;
  fileName?: string;
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

  // See the const above and src/lib/rateLimit.ts: checkRateLimit is a no-op
  // without a Firewall rule this project's plan doesn't support creating;
  // checkBlobRateLimit is the real cap.
  const { rateLimited } = await checkRateLimit("parse-video", { request });
  const { ok } = await checkBlobRateLimit(
    "parse-video",
    entitlement.teamId,
    PARSE_VIDEO_RATE_LIMIT.limit,
    PARSE_VIDEO_RATE_LIMIT.windowMs,
  );
  if (rateLimited || !ok) {
    return NextResponse.json(
      { error: "Too many clips submitted recently. Wait a few minutes and try again." },
      { status: 429 },
    );
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.videoUrl) {
    return NextResponse.json({ error: "videoUrl is required" }, { status: 400 });
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

  let detection;
  try {
    // The clip is uploaded as a private blob (see page.tsx) — reading it back
    // server-side needs the same auth a private blob always requires.
    detection = await detectPlayFromClip({ ai, blobToken, videoUrl: body.videoUrl });
  } catch (error) {
    const status = error instanceof VideoDetectionError ? error.status : 502;
    const message = error instanceof Error ? error.message : "Could not process this clip";
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ detection, fileName: body.fileName ?? "video" });
}

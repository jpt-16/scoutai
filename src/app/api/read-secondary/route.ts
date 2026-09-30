/**
 * Reads the opponent's secondary off a pre-snap clip: takes `{ videoUrl }`
 * (a private blob from /api/blob-upload, like /api/parse-video), asks Gemini
 * 2.5 Flash where the two corners and two safeties line up, each safety's
 * and corner's depth in yards off the line of scrimmage from the yard lines,
 * who he's over and his shade, and returns a table for the Scout D cards
 * (src/lib/secondary.ts `alignmentFromFilm`). Gated and rate limited like the
 * other film routes.
 */

import { checkRateLimit } from "@vercel/firewall";
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { NextResponse } from "next/server";
import { requireEntitlement } from "@/lib/entitlement";
import { generateJson } from "@/lib/gemini";
import { checkBlobRateLimit } from "@/lib/rateLimit";
import { alignmentFromFilm, DB_SLOTS, FILM_ANCHORS } from "@/lib/secondary";
import { TIER_LIMITS } from "@/lib/usageLimits";
import { QB_ANCHOR_RULES, uploadClipToGemini, VideoDetectionError } from "@/lib/videoDetection";

export const runtime = "nodejs";
export const maxDuration = 300;

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    formation: { type: Type.STRING, description: "The offense's formation, e.g. Trips Right, 2x2 Spread" },
    dbs: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          slot: { type: Type.STRING, enum: [...DB_SLOTS] },
          depthYards: { type: Type.NUMBER, description: "Yards off the line of scrimmage" },
          anchor: { type: Type.STRING, enum: [...FILM_ANCHORS] },
          shade: { type: Type.STRING, enum: ["inside", "head-up", "outside"] },
          side: { type: Type.STRING, enum: ["strong", "weak"] },
        },
        required: ["slot", "depthYards", "anchor", "shade"],
      },
    },
  },
  required: ["dbs"],
};

const PROMPT = `You are a high school defensive coordinator breaking down film.

${QB_ANCHOR_RULES}

Using that anchor, look at the moment just before the snap and find the defense's secondary (the
team across the line facing the QB): the two cornerbacks and the two safeties.

For each, give:
- slot: "cs" = the corner on the offense's strong side (the side with more receivers; the tight end
  side if it's even), "cw" = the other corner, "fs" = the free safety (the deeper or middle safety),
  "ss" = the strong safety (the one down in the box or rolled to the strength).
- depthYards: how deep he is, in yards, from the line of scrimmage to where he lines up. Measure it
  with the yard lines (5 yards apart) and the numbers on the field, not by guessing from the camera.
- anchor: which offensive player he's lined up over on his side, counting receivers from the
  sideline in ("1" = the widest, "2", "3"), or "ball" if he's in the middle of the field, or
  "hash" if he's on the hash with no receiver near.
- shade: "inside", "head-up" or "outside" of that receiver (inside = toward the ball).
- side: for the safeties, "strong" or "weak" side of the formation.
Also give the offense's formation as a short name.
Only report players you can actually see before the snap.`;

export async function POST(request: Request): Promise<NextResponse> {
  const entitlement = await requireEntitlement();
  if (!entitlement.ok) {
    return NextResponse.json(
      { error: entitlement.error, message: entitlement.message },
      { status: entitlement.status },
    );
  }

  const { rateLimited } = await checkRateLimit("read-secondary", { request });
  const { limit, windowMs } = TIER_LIMITS[entitlement.tier].clips;
  const { ok } = await checkBlobRateLimit(`read-secondary-${entitlement.tier}`, entitlement.teamId, limit, windowMs);
  if (rateLimited || !ok) {
    return NextResponse.json({ error: "Too many clips read recently. Try again in a few minutes." }, { status: 429 });
  }

  let body: { videoUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.videoUrl !== "string" || !body.videoUrl) {
    return NextResponse.json({ error: "videoUrl is required" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!apiKey || !blobToken) {
    return NextResponse.json({ error: "Server is missing GEMINI_API_KEY or BLOB_READ_WRITE_TOKEN" }, { status: 500 });
  }

  const ai = new GoogleGenAI({ apiKey });
  let responseText: string | undefined;
  try {
    const { fileUri, mimeType } = await uploadClipToGemini(ai, blobToken, body.videoUrl);
    const answer = await generateJson(ai, {
      contents: [{ role: "user", parts: [{ fileData: { fileUri, mimeType } }, { text: PROMPT }] }],
      schema: RESPONSE_SCHEMA,
      label: "read-secondary",
    });
    if (!answer.ok) throw new VideoDetectionError(`The AI couldn't read this clip (${answer.error})`, 502);
    responseText = answer.text;
  } catch (error) {
    const status = error instanceof VideoDetectionError ? error.status : 502;
    const message = error instanceof VideoDetectionError ? error.message : "The AI couldn't read this clip";
    if (!(error instanceof VideoDetectionError)) console.error("read-secondary: Gemini failed", error);
    return NextResponse.json({ error: message }, { status });
  }

  let parsed: { dbs?: unknown; formation?: unknown };
  try {
    parsed = JSON.parse(responseText ?? "");
  } catch {
    return NextResponse.json({ error: "The AI returned invalid JSON" }, { status: 502 });
  }
  const alignment = alignmentFromFilm(parsed.dbs);
  if (!alignment) {
    return NextResponse.json({ error: "The AI couldn't find the secondary in this clip" }, { status: 422 });
  }
  return NextResponse.json({
    alignment,
    formation: typeof parsed.formation === "string" ? parsed.formation.slice(0, 60) : "",
  });
}

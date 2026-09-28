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
 * Needs a `GEMINI_API_KEY` env var (Vercel project settings + `.env.local`
 * for dev; `.env*` is already gitignored). Uses `@google/genai`'s current
 * unified SDK — worth a quick check against its docs if this route starts
 * failing after a dependency bump, since that SDK's surface has moved
 * before and this wasn't tested against a live API key in this session.
 */

import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { NextResponse } from "next/server";
import { validateDetectedPlay, type DetectedPlay } from "@/lib/videoImport";

export const runtime = "nodejs";
// Vision analysis of even a short clip can take a while. Raise this if your
// Vercel plan allows it (Hobby caps function duration much lower than Pro) —
// confirm the actual current limit for your plan rather than trusting this number.
export const maxDuration = 300;

const percentPointSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    x: { type: Type.NUMBER, description: "0-100, percent of frame width from the left" },
    y: { type: Type.NUMBER, description: "0-100, percent of frame height from the top" },
  },
  required: ["x", "y"],
};

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    playName: { type: Type.STRING, description: "Short label for the play concept" },
    formation: { type: Type.STRING, description: "e.g. \"Spread 2x2\", \"Trips Right\"" },
    players: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: {
            type: Type.STRING,
            enum: ["Q", "F", "H", "X", "Y", "Z"],
            description: "This staff's letter convention — Q=QB, F/H=backs, X/Y/Z=receivers/TE",
          },
          routeType: { type: Type.STRING, description: "A short guess at the route name, if obvious" },
          start: percentPointSchema,
          waypoints: { type: Type.ARRAY, items: percentPointSchema },
          endpoint: percentPointSchema,
        },
        required: ["label", "start", "waypoints", "endpoint"],
      },
    },
  },
  required: ["playName", "formation", "players"],
};

const PROMPT = `You are watching one football play from a single clip (sideline or endzone camera).

Identify only the offensive skill players — never linemen — using exactly these letters, this
staff's own convention (not QB/RB/TE): Q = quarterback, F and H = the running backs (F usually
lines up ahead of H), X, Y, Z = wide receivers or a tight end. Only report players you can
actually see and track for at least part of the play; never invent one you can't follow.

For each player give:
- start: where they line up at the snap, as {x, y} percent of the frame (0-100 each axis, 0,0
  is the top-left corner)
- waypoints: the points along their path where their direction clearly changes (zero or more —
  omit for a straight release)
- endpoint: where they are when the play ends or the clip cuts
- routeType: a short guess at the route name if it's obvious (e.g. "SLANT", "GO", "BUBBLE") —
  omit if you're not confident

Also give playName (a short label for what the offense ran) and formation (e.g. "Spread 2x2",
"Trips Right", "I-Form").`;

interface RequestBody {
  videoUrl?: string;
  fileName?: string;
}

export async function POST(request: Request): Promise<NextResponse> {
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

  let videoResponse: Response;
  try {
    videoResponse = await fetch(body.videoUrl);
  } catch {
    return NextResponse.json({ error: "Could not fetch the uploaded clip" }, { status: 400 });
  }
  if (!videoResponse.ok) {
    return NextResponse.json(
      { error: `Could not fetch the uploaded clip (${videoResponse.status})` },
      { status: 400 },
    );
  }
  const videoBlob = await videoResponse.blob();

  const ai = new GoogleGenAI({ apiKey });

  let fileUri: string | undefined;
  let mimeType: string | undefined;
  try {
    const uploaded = await ai.files.upload({
      file: videoBlob,
      config: { mimeType: videoBlob.type || "video/mp4" },
    });
    fileUri = uploaded.uri;
    mimeType = uploaded.mimeType;
  } catch (error) {
    console.error("parse-video: Gemini file upload failed", error);
    return NextResponse.json({ error: "Could not upload the clip to the vision model" }, { status: 502 });
  }
  if (!fileUri) {
    return NextResponse.json({ error: "Vision model upload did not return a file reference" }, { status: 502 });
  }

  let responseText: string | undefined;
  try {
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [{ fileData: { fileUri, mimeType: mimeType ?? "video/mp4" } }, { text: PROMPT }],
        },
      ],
      config: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
    });
    responseText = result.text;
  } catch (error) {
    console.error("parse-video: Gemini generateContent failed", error);
    return NextResponse.json({ error: "The vision model could not process this clip" }, { status: 502 });
  }

  let detection: unknown;
  try {
    detection = JSON.parse(responseText ?? "");
  } catch {
    return NextResponse.json({ error: "The vision model returned invalid JSON" }, { status: 502 });
  }

  const problem = validateDetectedPlay(detection);
  if (problem) {
    return NextResponse.json({ error: `The vision model's response was unusable: ${problem}` }, { status: 502 });
  }

  return NextResponse.json({ detection: detection as DetectedPlay, fileName: body.fileName ?? "video" });
}

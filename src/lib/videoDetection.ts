/**
 * Shared core of "send one clip to Gemini, get a validated route detection
 * back" — used by both `/api/parse-video` (one clip) and
 * `/api/parse-video-batch` (several, run concurrently) so the prompt,
 * response schema, and step-by-step error handling live in exactly one
 * place. See those routes' doc comments for the surrounding HTTP contract.
 *
 * Needs a `GEMINI_API_KEY` env var (Vercel project settings + `.env.local`
 * for dev). Uses `@google/genai`'s current unified SDK — worth a quick check
 * against its docs if this starts failing after a dependency bump, since
 * that SDK's surface has moved before and this wasn't tested against a live
 * API key in this session.
 */

import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { validateDetectedPlay, type DetectedPlay } from "./videoImport";

/** Thrown by `detectPlayFromClip` with the HTTP status the failure maps to. */
export class VideoDetectionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "VideoDetectionError";
    this.status = status;
  }
}

const percentPointSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    x: { type: Type.NUMBER, description: "0-100, percent of frame width from the left" },
    y: { type: Type.NUMBER, description: "0-100, percent of frame height from the top" },
  },
  required: ["x", "y"],
};

export const DETECTION_RESPONSE_SCHEMA: Schema = {
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

export const DETECTION_PROMPT = `You are watching one football play from a single clip (sideline or endzone camera).

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

/**
 * Route geometry for named concepts, so a recognized call comes back shaped
 * the way this staff draws it (same depths as the route tree in
 * formations.ts: shallow at 5, out and corner off a 10-yard stem) instead of
 * the model's loose guess.
 */
export const FOOTBALL_CONCEPT_RULES = `Apply these exact route rules when the play call (or the concept you recognize on film)
includes one of these keywords:

1. MESH: the two inside receivers (usually H and Y) run shallow crossing / drag routes
   underneath each other across the formation at 3-5 yards depth, passing right next to each
   other over the ball.
2. RAIL / WHEEL: a back or slot receiver (F, H or the inside receiver) releases out to the flat,
   then turns vertically UP the sideline past the line of scrimmage.
3. CORNER / OUT: outside receivers (X, Z) take a 10-yard stem, then break at a 45-degree angle
   toward the pylon (CORNER) or break sharp at 90 degrees to the sideline (OUT).`;

/** Longest play call passed through to the prompt; a real call is a few words. */
const MAX_PLAY_CALL_LENGTH = 80;

/**
 * The full prompt for one clip. With the coach's play call (from the Hudl CSV
 * row the clip was matched to) the model is told what was called, so a MESH
 * or WHEEL call is drawn with that concept's geometry.
 */
export function buildDetectionPrompt(playCall?: string): string {
  const call = (playCall ?? "")
    .replace(/[\r\n"'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PLAY_CALL_LENGTH);
  const callLine = call
    ? `\n\nThe coach's play call for this clip is "${call}". Analyze the play for that call, and make ` +
      "the route coordinates strictly follow the concept geometry rules above for any concept it names."
    : "\n\nIf you recognize one of the concepts above, make the route coordinates strictly follow its " +
      "geometry rules.";
  return `${DETECTION_PROMPT}\n\n${FOOTBALL_CONCEPT_RULES}${callLine}`;
}

export interface DetectClipOptions {
  /** A `GoogleGenAI` client, constructed once per request and reused across clips in a batch. */
  ai: GoogleGenAI;
  /** Vercel Blob read token — the clip is a private blob, so reading it back needs auth. */
  blobToken: string;
  videoUrl: string;
  /** The coach's play call for this clip, when a CSV row is behind it (batch import). */
  playCall?: string;
}

/**
 * Fetches a private blob clip, sends it to Gemini for route detection, and
 * returns a validated `DetectedPlay`. Throws `VideoDetectionError` on any
 * failure step (fetch, Gemini upload, generateContent, JSON parse, or
 * schema validation) with the HTTP status that failure maps to, for the
 * caller to relay (single-clip route) or record per-item (batch route).
 */
export async function detectPlayFromClip({
  ai,
  blobToken,
  videoUrl,
  playCall,
}: DetectClipOptions): Promise<DetectedPlay> {
  let videoResponse: Response;
  try {
    videoResponse = await fetch(videoUrl, { headers: { Authorization: `Bearer ${blobToken}` } });
  } catch {
    throw new VideoDetectionError("Could not fetch the uploaded clip", 400);
  }
  if (!videoResponse.ok) {
    throw new VideoDetectionError(`Could not fetch the uploaded clip (${videoResponse.status})`, 400);
  }
  const videoBlob = await videoResponse.blob();

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
    console.error("videoDetection: Gemini file upload failed", error);
    throw new VideoDetectionError("Could not upload the clip to the vision model", 502);
  }
  if (!fileUri) {
    throw new VideoDetectionError("Vision model upload did not return a file reference", 502);
  }

  let responseText: string | undefined;
  try {
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [{ fileData: { fileUri, mimeType: mimeType ?? "video/mp4" } }, { text: buildDetectionPrompt(playCall) }],
        },
      ],
      config: { responseMimeType: "application/json", responseSchema: DETECTION_RESPONSE_SCHEMA },
    });
    responseText = result.text;
  } catch (error) {
    console.error("videoDetection: Gemini generateContent failed", error);
    throw new VideoDetectionError("The vision model could not process this clip", 502);
  }

  let detection: unknown;
  try {
    detection = JSON.parse(responseText ?? "");
  } catch {
    throw new VideoDetectionError("The vision model returned invalid JSON", 502);
  }

  const problem = validateDetectedPlay(detection);
  if (problem) {
    throw new VideoDetectionError(`The vision model's response was unusable: ${problem}`, 502);
  }

  return detection as DetectedPlay;
}

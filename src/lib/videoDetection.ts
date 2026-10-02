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
import { generateJson } from "./gemini";
import { FILM_ROUTE_NAMES, validateDetectedPlay, type DetectedPlay } from "./videoImport";

/**
 * Frames per second the film AI sees (Gemini's default is 1). A Hudl clip is
 * 5-12 seconds, so this is 40-100 frames, about 10-25k input tokens.
 */
export const FILM_FPS = 8;

/** Thrown by `detectPlayFromClip` with the HTTP status the failure maps to. */
export class VideoDetectionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "VideoDetectionError";
    this.status = status;
  }
}

/** A spot on the field in yards from the ball at the snap (not the screen: see `DETECTION_PROMPT`). */
const yardPointSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    x: { type: Type.NUMBER, description: "Yards to the offense's right (+) or left (-) of the ball" },
    y: { type: Type.NUMBER, description: "Yards past the line of scrimmage (+) or behind it into the backfield (-)" },
  },
  required: ["x", "y"],
};

const barField = (description: string): Schema => ({ type: Type.STRING, description });

export const DETECTION_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    playName: { type: Type.STRING, description: "Short label for the play concept" },
    formation: { type: Type.STRING, description: "e.g. \"Spread 2x2\", \"Trips Right\"" },
    camera: { type: Type.STRING, enum: ["sideline", "endzone", "other"], description: "Where the camera is" },
    hudl: {
      type: Type.OBJECT,
      description: "Hudl's data bar if it's on screen (a recording of Hudl), copied exactly; \"\" for columns not shown",
      properties: {
        playNumber: barField("PLAY #"),
        formation: barField("OFF FORM"),
        playCall: barField("OFF PLAY"),
        playType: barField("PLAY TYPE"),
        hash: barField("HASH"),
        offStrength: barField("OFF STR"),
        playDir: barField("PLAY DIR"),
      },
    },
    playType: { type: Type.STRING, enum: ["run", "pass", "unknown"], description: "What the QB did with the ball" },
    ballCarrier: {
      type: Type.STRING,
      enum: ["Q", "F", "H", "X", "Y", "Z", "none"],
      description: "Who got the ball from the QB (handoff or catch); Q if he kept it; none if unclear",
    },
    ballDirection: {
      type: Type.STRING,
      enum: ["left", "right", "middle", "unknown"],
      description: "Where the ball went, as the offense's left/right facing upfield the way the QB faces",
    },
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
          routeType: {
            type: Type.STRING,
            enum: [...FILM_ROUTE_NAMES],
            description: "What he did, by this staff's route names (see the route list); BLOCK, FAKE, CARRY or NONE if not a route",
          },
          start: yardPointSchema,
          waypoints: { type: Type.ARRAY, items: yardPointSchema },
          endpoint: yardPointSchema,
        },
        required: ["label", "start", "waypoints", "endpoint"],
      },
    },
  },
  required: ["playName", "formation", "players"],
};

/**
 * The route names the film AI must pick from (the schema's enum), each with
 * the staff's own technique, so the same clip reads the same way every time
 * and a recognized route is drawn exactly like the route tree
 * (`videoImport.ts` snaps it).
 */
export const FILM_ROUTE_GUIDE = `  SLIDE (0): releases outside right away and builds up to about 5 yards, then settles. A WING or
    tight slot (within about 3 yards outside the tackle or tight end) who releases to the flat is
    ALWAYS a SLIDE, even if he bellies back a step.
  SPEED OUT (1): out cut at 5 yards.   SLANT (2): three steps, then 45 degrees inside.
  OUT (3): 10-yard stem, 90 degrees to the sideline.   CURL (4): to 12, back down to 10.
  COMEBACK (5): to 16, back down to 14.   SHALLOW (6): builds to 5 and crosses the field.
  CORNER (7): 10-yard stem, 45 degrees to the pylon.   POST (8): 10-yard stem, 45 degrees inside.
  FADE (9): vertical with a slight outside release.   GO: straight vertical.
  HITCH: to 5, turn back.   DIG: 10-yard in cut.   DRAG: shallow cross at 2-3 yards.
  FLAT: out to the flat at 1-2 yards.   SWING: a back curving out to the flat behind the line.
  WHIP: a slant inside, then a sharp break back outside to the flat.
  BUBBLE: a slot split away from the box who drops BACK first (behind where he lined up), then
    curls out toward the sideline. Only if he clearly loses ground first; a flat release is a
    SLIDE or FLAT, and a wing is never a BUBBLE.
  WHEEL: out to the flat, then turns up the sideline.   RAIL: a back out to the flat and up.
  LEAK: a tight end who blocks, then slips out the backside.
  BLOCK: blocked (stalk, crack, pass pro) instead of running a route.
  FAKE: carried out a run fake / mesh without the ball.
  CARRY: the ball carrier on a run (handoff, pitch, QB keep).
  NONE: you can't tell.`;

/**
 * How the film AI tells offense from defense and follows the ball: find the
 * quarterback first and anchor everything on him. Shared by the route
 * detection prompt and the secondary read (`/api/read-secondary`).
 */
export const QB_ANCHOR_RULES = `ANCHOR RULE: LOCATE THE QUARTERBACK FIRST.
1. Identify the QB: the player who receives the snap directly behind the offensive line, either
   under center or 4-5 yards back in the shotgun.
2. Offense vs. defense, by the QB: the team in the QB's jersey is the OFFENSE. The direction the QB
   faces before the snap is UPFIELD. Every player on the QB's side of the line of scrimmage is
   offense (QB, backs, receivers, linemen); every player across the line facing the QB is defense.
   Left and right always mean the offense's left and right, facing upfield the way the QB faces,
   not the camera's.
3. Follow the ball: trace it from the snap. The player who takes it from the QB (a handoff, a
   pitch or a catch) is the ball carrier; the QB is the ball carrier if he keeps it. If the QB
   hands off or throws to his left, the play goes LEFT (the left flat / field); to his right, RIGHT.`;

export const DETECTION_PROMPT = `You are watching one football play from a single clip (sideline or endzone camera).

${QB_ANCHOR_RULES}

Identify only the offensive skill players — never linemen — using exactly these letters, this
staff's own convention (not QB/RB/TE): Q = quarterback, F and H = the running backs (F usually
lines up ahead of H), X, Y, Z = wide receivers or a tight end. Only report players you can
actually see and track for at least part of the play; never invent one you can't follow.

THE CLIP ITSELF:
- It may be a screen recording of Hudl or another video player: ignore everything that isn't the
  field (menus, the data bar, playback controls, a desktop or other windows at the start or end).
- If Hudl's data bar is on screen (PLAY #, ODK, DN/DIST, HASH, OFF FORM, OFF PLAY, OFF STR, PLAY
  DIR...), copy it into "hudl" exactly as written. It's the coach's own tagging of this play.
- Say where the camera is: "sideline" (the offense moves across the screen; the most common high
  school angle), "endzone" (the offense moves up or down the screen) or "other". The camera may
  pan and zoom to follow the ball.

POSITIONS ARE FIELD YARDS, NEVER SCREEN POSITION. Measure every point from the ball at the snap,
using the yard lines (5 yards apart), hash marks and numbers painted on the field, not where the
player is on the screen:
- x = yards to the OFFENSE'S right (+) or left (-) of the ball, facing upfield the way the QB
  faces. A receiver split out 15 yards to the offense's left is x = -15; the field is 53 yards
  wide, so x stays within about -27..27.
- y = yards past the line of scrimmage (+, upfield) or behind it into the backfield (-). A
  shotgun QB is about y = -5; a 10-yard out breaks at y = 10.
From a sideline camera, upfield runs ACROSS the screen, toward the side the QB faces, and the
offense's left / right run toward or away from the camera; from an end zone camera behind the
offense, upfield is up the screen. Because the camera may pan, track each player against the
field markings, never against the frame.

For each player give:
- start: where he lines up at the snap, {x, y} in yards as above
- waypoints: the points along his ROUTE where his direction clearly changes (zero or more;
  omit for a straight release)
- endpoint: where his ROUTE ends: the catch point for the man who catches it, about where he is
  when the ball is thrown or handed to someone else for everyone else. NEVER follow a receiver
  after the catch: the run after the catch is not part of the route. The ball carrier on a run:
  stop about 5 yards past the line.
- routeType: what he ACTUALLY did on the film, using exactly one of this staff's names. The data
  bar and any play call are the coach's tags: they can be wrong, or name the RPO option that
  wasn't thrown. Never pick a route name because a tag says it; watch the player.
${FILM_ROUTE_GUIDE}

Also give playName (a short label for what the offense ran; "RPO SLIDE / WING FLAT" for a wing
slide, with that player's routeType "SLIDE") and formation (e.g. "Spread 2x2",
"Trips Right", "I-Form"), plus, from the anchor rule: playType ("run" or "pass"), ballCarrier (the
letter of the player who got the ball from the QB, "Q" if he kept it, "none" if you can't tell) and
ballDirection ("left", "right" or "middle", the offense's side).`;

/**
 * Route geometry for named concepts, so a recognized call comes back shaped
 * the way this staff draws it (same depths as the route tree in
 * formations.ts: shallow at 5, out and corner off a 10-yard stem) instead of
 * the model's loose guess.
 */
export const FOOTBALL_CONCEPT_RULES = `Apply these exact route rules when the play call (or the concept you recognize on film)
includes one of these keywords:

1. MESH: the inside receiver on each side (the slots — F and Y in Deuces) runs a shallow
   crossing / drag route across the formation at 3-5 yards depth, one slightly under the
   other, so they pass right next to each other over the ball. The backside outside receiver
   runs a post and the play-side one a corner unless the call names another route.
2. RAIL / WHEEL (a separate tag that can ride on any concept, e.g. "MESH RAIL"): the back (H in Deuces; a slot if there's no back) releases out to the flat,
   then turns vertically UP the sideline past the line of scrimmage.
3. CORNER / OUT: outside receivers (X, Z) take a 10-yard stem, then break at a 45-degree angle
   toward the pylon (CORNER) or break sharp at 90 degrees to the sideline (OUT).
4. RPO SLIDE / WING FLAT: detect if the innermost receiver is aligned as a flexed Wing back (off the
   line, within about 3 yards outside the tackle or tight end). If the Wing runs flat across the
   formation or into the immediate flat under outside blocking receivers, tag the concept as
   "RPO SLIDE / WING FLAT". Draw his route as an immediate flat release 2-3 yards behind the
   line of scrimmage toward the sideline (a SLIDE), and the receivers outside him as blockers:
   short paths up and back inside at the alley and perimeter defenders (crack / stalk), not routes. Keep his own letter; "Wing" is his alignment, not a letter.`;

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
/**
 * Fetches a private blob clip and uploads it to Gemini's file store, for any
 * route that sends film to the model (route detection here, the secondary
 * read in /api/read-secondary). Throws `VideoDetectionError` with the HTTP
 * status each failure maps to.
 */
export async function uploadClipToGemini(
  ai: GoogleGenAI,
  blobToken: string,
  videoUrl: string,
): Promise<{ fileUri: string; mimeType: string }> {
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

  return { fileUri, mimeType: mimeType ?? "video/mp4" };
}

export async function detectPlayFromClip({
  ai,
  blobToken,
  videoUrl,
  playCall,
}: DetectClipOptions): Promise<DetectedPlay> {
  const { fileUri, mimeType } = await uploadClipToGemini(ai, blobToken, videoUrl);

  const answer = await generateJson(ai, {
    contents: [
      {
        role: "user",
        parts: [
          // The default is 1 frame a second: a release, a break, a slide vs. a bubble all happen
          // between frames. Routes need several frames a second to be seen at all.
          { fileData: { fileUri, mimeType: mimeType ?? "video/mp4" }, videoMetadata: { fps: FILM_FPS } },
          { text: buildDetectionPrompt(playCall) },
        ],
      },
    ],
    schema: DETECTION_RESPONSE_SCHEMA,
    label: "videoDetection",
    // The same clip should read the same way every time.
    deterministic: true,
  });
  if (!answer.ok) {
    throw new VideoDetectionError(`The vision model could not process this clip (${answer.error})`, 502);
  }
  const responseText = answer.text;

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

  // The prompt asks for field yards (not frame percentages): the card maps them to scale.
  return { ...(detection as DetectedPlay), units: "yards" };
}

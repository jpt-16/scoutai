/**
 * Text → scout card. Takes `{ playName, formation, defensiveCall? }`
 * ("Deuces Mesh Rail", "Deuces", "Cover 3"), asks Gemini 2.5 Flash for 0-100
 * grid coordinates for all 22 players under a strict response schema, and
 * returns a finished `HudlPlayCard` (see src/lib/generatedCard.ts): the
 * formation drawn in its usual shape, each receiver's route as a draggable
 * `source: "ai"` path, and each defender moved onto the card's own ids.
 *
 * Paid and gated exactly like /api/parse-video: every call costs Gemini
 * money, so it's entitlement-checked first, then rate limited per team.
 */

import { checkRateLimit } from "@vercel/firewall";
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { NextResponse } from "next/server";
import { requireEntitlement } from "@/lib/entitlement";
import {
  applyGeneratedPlay,
  buildGenerationPrompt,
  DEFENSE_LABELS,
  generationContext,
  MAX_INPUT_LENGTH,
  OFFENSE_LABELS,
  shellCard,
  validateGeneratedPlay,
  type GeneratedPlay,
} from "@/lib/generatedCard";
import { checkBlobRateLimit } from "@/lib/rateLimit";

// Text-only calls are cheaper than video, but still real money per call.
const GENERATE_RATE_LIMIT = { limit: 10, windowMs: 10 * 60 * 1000 }; // 10 per 10 minutes per team

export const runtime = "nodejs";
export const maxDuration = 60;

const gridPoint: Schema = {
  type: Type.OBJECT,
  properties: {
    x: { type: Type.NUMBER, description: "0-100, left sideline to right sideline" },
    y: { type: Type.NUMBER, description: "0-100, downfield (top) to behind the offense (bottom)" },
  },
  required: ["x", "y"],
};

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    offense: {
      type: Type.ARRAY,
      description: "All 11 offensive players",
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING, enum: [...OFFENSE_LABELS] },
          x: { type: Type.NUMBER },
          y: { type: Type.NUMBER },
          routeName: { type: Type.STRING, description: "Short route name, e.g. DRAG, RAIL, POST" },
          route: {
            type: Type.ARRAY,
            description: "Points after the start: one per break, then the end",
            items: gridPoint,
          },
        },
        required: ["label", "x", "y"],
      },
    },
    defense: {
      type: Type.ARRAY,
      description: "All 11 defensive players",
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING, enum: [...DEFENSE_LABELS] },
          x: { type: Type.NUMBER },
          y: { type: Type.NUMBER },
        },
        required: ["label", "x", "y"],
      },
    },
  },
  required: ["offense", "defense"],
};

interface RequestBody {
  playName?: unknown;
  formation?: unknown;
  defensiveCall?: unknown;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function POST(request: Request): Promise<NextResponse> {
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
  const { rateLimited } = await checkRateLimit("generate-scout-card", { request });
  const { ok } = await checkBlobRateLimit(
    "generate-scout-card",
    entitlement.teamId,
    GENERATE_RATE_LIMIT.limit,
    GENERATE_RATE_LIMIT.windowMs,
  );
  if (rateLimited || !ok) {
    return NextResponse.json(
      { error: "Too many cards generated recently. Wait a few minutes and try again." },
      { status: 429 },
    );
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const input = {
    playName: text(body.playName),
    formation: text(body.formation),
    defensiveCall: text(body.defensiveCall),
  };
  if (!input.playName) {
    return NextResponse.json({ error: "playName is required" }, { status: 400 });
  }
  if ([input.playName, input.formation, input.defensiveCall].some((s) => s.length > MAX_INPUT_LENGTH)) {
    return NextResponse.json(
      { error: `Keep each field under ${MAX_INPUT_LENGTH} characters` },
      { status: 400 },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Server is missing GEMINI_API_KEY" }, { status: 500 });
  }

  const card = shellCard(input);
  const ctx = generationContext(card);
  let responseText: string | undefined;
  try {
    const result = await new GoogleGenAI({ apiKey }).models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: buildGenerationPrompt(input, ctx) }] }],
      config: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
    });
    responseText = result.text;
  } catch (error) {
    console.error("generate-scout-card: Gemini generateContent failed", error);
    return NextResponse.json({ error: "The AI couldn't draw this play. Try again." }, { status: 502 });
  }

  let generated: unknown;
  try {
    generated = JSON.parse(responseText ?? "");
  } catch {
    return NextResponse.json({ error: "The AI returned invalid JSON" }, { status: 502 });
  }
  const problem = validateGeneratedPlay(generated);
  if (problem) {
    return NextResponse.json({ error: `The AI's answer was unusable: ${problem}` }, { status: 502 });
  }

  return NextResponse.json({ card: applyGeneratedPlay(card, ctx, generated as GeneratedPlay) });
}

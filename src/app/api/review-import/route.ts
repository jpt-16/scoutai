/**
 * AI review of a CSV import: takes the rows the in-browser parser couldn't
 * place (`{ rows: [{ id, formation, playCall, playType, defFront, positions }] }`,
 * built by src/lib/importReview.ts's `reviewRows`), asks Gemini 2.5 Flash to
 * read the staff's shorthand, and build a route concept for one-route passes,
 * under a strict schema, and returns one answer per row for `applyReview`. Gated and rate limited like
 * the other AI routes; one call per import.
 */

import { checkRateLimit } from "@vercel/firewall";
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { NextResponse } from "next/server";
import { requireEntitlement } from "@/lib/entitlement";
import {
  buildReviewPrompt,
  MAX_REVIEW_ROWS,
  REVIEW_FORMATIONS,
  REVIEW_FRONTS,
  REVIEW_ROUTES,
  REVIEW_SLOTS,
  sanitizeReviewRow,
  validateReview,
  type ReviewRow,
} from "@/lib/importReview";
import { checkBlobRateLimit } from "@/lib/rateLimit";
import { TIER_LIMITS } from "@/lib/usageLimits";

export const runtime = "nodejs";
export const maxDuration = 60;

const routeChoice: Schema = { type: Type.STRING, enum: [...REVIEW_ROUTES, "protect", "none"] };

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    results: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          formation: { type: Type.STRING, enum: [...REVIEW_FORMATIONS, "unknown"] },
          side: { type: Type.STRING, enum: ["left", "right", "unknown"] },
          playType: { type: Type.STRING, enum: ["run", "pass", "unknown"] },
          front: { type: Type.STRING, enum: [...REVIEW_FRONTS, "unknown"] },
          routes: {
            type: Type.OBJECT,
            description: "Only for rows marked 'build routes for': a route per position",
            properties: Object.fromEntries(REVIEW_SLOTS.map((slot) => [slot, routeChoice])),
          },
        },
        required: ["id", "formation", "side", "playType", "front"],
      },
    },
  },
  required: ["results"],
};

export async function POST(request: Request): Promise<NextResponse> {
  const entitlement = await requireEntitlement();
  if (!entitlement.ok) {
    return NextResponse.json(
      { error: entitlement.error, message: entitlement.message },
      { status: entitlement.status },
    );
  }

  const { rateLimited } = await checkRateLimit("review-import", { request });
  const { limit, windowMs } = TIER_LIMITS[entitlement.tier].reviews;
  const { ok } = await checkBlobRateLimit(`review-import-${entitlement.tier}`, entitlement.teamId, limit, windowMs);
  if (rateLimited || !ok) {
    return NextResponse.json({ error: "Too many imports reviewed recently. Try again in a few minutes." }, { status: 429 });
  }

  let body: { rows?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: "No rows to review" }, { status: 400 });
  }
  if (body.rows.length > MAX_REVIEW_ROWS) {
    return NextResponse.json({ error: `At most ${MAX_REVIEW_ROWS} rows per review` }, { status: 400 });
  }
  const rows = body.rows.map(sanitizeReviewRow).filter((r): r is ReviewRow => r !== null);
  if (rows.length === 0) {
    return NextResponse.json({ error: "No usable rows" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Server is missing GEMINI_API_KEY" }, { status: 500 });
  }

  let responseText: string | undefined;
  try {
    const result = await new GoogleGenAI({ apiKey }).models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: buildReviewPrompt(rows) }] }],
      config: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
    });
    responseText = result.text;
  } catch (error) {
    console.error("review-import: Gemini generateContent failed", error);
    return NextResponse.json({ error: "The AI couldn't review this import" }, { status: 502 });
  }

  let review: unknown;
  try {
    review = JSON.parse(responseText ?? "");
  } catch {
    return NextResponse.json({ error: "The AI returned invalid JSON" }, { status: 502 });
  }
  const problem = validateReview(review);
  if (problem) {
    return NextResponse.json({ error: `The AI's review was unusable: ${problem}` }, { status: 502 });
  }
  // Only answers for rows that were actually sent.
  const sent = new Set(rows.map((r) => r.id));
  const results = (review as { results: { id: string }[] }).results.filter((r) => sent.has(r.id));
  return NextResponse.json({ reviewedIds: [...sent], results });
}

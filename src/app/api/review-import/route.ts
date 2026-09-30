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
import { mapWithConcurrency } from "@/lib/concurrency";
import {
  buildReviewPrompt,
  MAX_REVIEW_ROWS,
  parseRouteList,
  REVIEW_CHUNK,
  REVIEW_FORMATIONS,
  REVIEW_FRONTS,
  sanitizeReviewRow,
  validateReview,
  type ReviewResult,
  type ReviewRow,
} from "@/lib/importReview";
import { checkBlobRateLimit } from "@/lib/rateLimit";
import { TIER_LIMITS } from "@/lib/usageLimits";

export const runtime = "nodejs";
export const maxDuration = 60;

// Kept small on purpose: a route enum per position (nested, optional) made
// the schema too big for Gemini to serve, and every review failed. Routes are
// one string per row, parsed by `parseRouteList`.
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
            type: Type.STRING,
            description: "Only for rows marked 'build routes for': 'ps1 slant, ps2 flat, back protect'; else ''",
          },
        },
        required: ["id", "formation", "side", "playType", "front"],
      },
    },
  },
  required: ["results"],
};

type ChunkAnswer = { results: ReviewResult[] } | { error: string };

/** Gemini's own reason, short and one line, for the coach's notice and the logs. */
function reason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const status = text.match(/"status":\s*"([A-Z_]+)"/)?.[1] ?? text.match(/\b(4\d\d|5\d\d)\b/)?.[1];
  const message = text.match(/"message":\s*"([^"]{1,160})/)?.[1] ?? text.slice(0, 160);
  return [status, message].filter(Boolean).join(": ").replace(/\s+/g, " ");
}

/**
 * One chunk of rows. Thinking is off (this is lookup, not reasoning, and it
 * keeps a full game well inside the function's time); if Gemini refuses the
 * schema, it's asked again with plain JSON and the answer is checked here.
 */
async function reviewChunk(ai: GoogleGenAI, rows: ReviewRow[]): Promise<ChunkAnswer> {
  const prompt = buildReviewPrompt(rows);
  let lastError = "";
  for (const schema of [RESPONSE_SCHEMA, undefined]) {
    try {
      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          ...(schema ? { responseSchema: schema } : {}),
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      const review: unknown = JSON.parse(result.text ?? "");
      const problem = validateReview(review);
      if (problem) {
        lastError = `unusable answer (${problem})`;
        continue;
      }
      const results = (review as { results: (Omit<ReviewResult, "routes"> & { routes?: unknown })[] }).results.map(
        (r) => ({ ...r, routes: parseRouteList(r.routes) }),
      );
      return { results };
    } catch (error) {
      lastError = error instanceof SyntaxError ? "the AI returned invalid JSON" : reason(error);
      console.error(`review-import: Gemini ${schema ? "with schema" : "plain JSON"} failed`, error);
    }
  }
  return { error: lastError };
}

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

  const ai = new GoogleGenAI({ apiKey });
  const chunks: ReviewRow[][] = [];
  for (let i = 0; i < rows.length; i += REVIEW_CHUNK) chunks.push(rows.slice(i, i + REVIEW_CHUNK));
  const answers = await mapWithConcurrency(chunks, 4, (chunk) => reviewChunk(ai, chunk));
  const failed = answers.find((a): a is { error: string } => "error" in a);
  if (answers.every((a) => "error" in a)) {
    return NextResponse.json({ error: `The AI couldn't review this import (${failed?.error}).` }, { status: 502 });
  }
  const answered = answers.flatMap((a, i) => ("results" in a ? chunks[i] : []));
  const review = { results: answers.flatMap((a) => ("results" in a ? a.results : [])) };

  // Only answers for rows that were actually sent.
  // A chunk that failed isn't marked reviewed, so the next import tries it again.
  const sent = new Set(answered.map((r) => r.id));
  const results = review.results.filter((r) => sent.has(r.id));
  return NextResponse.json({ reviewedIds: [...sent], results });
}

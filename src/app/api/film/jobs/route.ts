/**
 * The staff's games.
 *
 *   GET  /api/film/jobs   → { jobs: JobView[] }, newest first
 *   POST /api/film/jobs   { files: [{ name, size }] } → { job, uploads: [{ index, name, pathname }] }
 *        Checks the files against the staff's limits and makes the game; the browser then uploads each clip
 *        to its `pathname` (through /api/film/upload) and calls .../start.
 *
 * Signed in and allowed, like the AI routes (and off wherever that gate is bypassed: it would be one shared
 * library for anyone holding the URL).
 */

import { NextResponse } from "next/server";
import { TIER_LIMITS } from "@/lib/usageLimits";
import { filmContext, filmError, filmGate } from "@/lib/film/runtime";
import { createJob, listViews } from "@/lib/film/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const gate = await filmGate();
  if (gate.error) return gate.error;
  try {
    return NextResponse.json({ jobs: await listViews(filmContext(request), gate.owner) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return filmError(error);
  }
}

export async function POST(request: Request) {
  const gate = await filmGate();
  if (gate.error) return gate.error;
  let body: { files?: unknown };
  try {
    body = (await request.json()) as { files?: unknown };
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Expected JSON." }, { status: 400 });
  }
  try {
    return NextResponse.json(await createJob(filmContext(request), gate.owner, TIER_LIMITS[gate.tier].film, body.files));
  } catch (error) {
    return filmError(error);
  }
}

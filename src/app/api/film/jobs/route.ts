/**
 * The staff's games.
 *
 *   GET  /api/film/jobs   → { jobs: JobView[] }, newest first
 *   POST /api/film/jobs   { files: [{ name, size }], kind?: "video", name?: "vs Central" } → { job, uploads: [{ index, name, pathname }] }
 *        `kind: "video"` is a whole game's video (a half, a game) for the worker to cut into plays, not one clip a play.
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
  let body: { files?: unknown; kind?: unknown; name?: unknown };
  try {
    body = (await request.json()) as { files?: unknown; kind?: unknown; name?: unknown };
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Expected JSON." }, { status: 400 });
  }
  try {
    return NextResponse.json(await createJob(filmContext(request), gate.owner, TIER_LIMITS[gate.tier].film, body.files, body.kind === "video" ? "video" : "clips", body.name));
  } catch (error) {
    return filmError(error);
  }
}

/**
 *   GET  → the clip's bytes, for the worker that was given this game (the app is the only thing holding the store's key).
 */

import { NextResponse } from "next/server";
import { filmContext, filmError, workerGate } from "@/lib/film/runtime";
import { openForWorker } from "@/lib/film/service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ team: string; id: string; index: string }> }) {
  const { team, id, index } = await params;
  const refused = workerGate(request, team, id);
  if (refused) return refused;
  if (!/^\d{1,4}$/.test(index)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const clip = await openForWorker(filmContext(request), team, id, "clip", Number(index));
    return new Response(clip.stream, {
      headers: { "content-type": clip.contentType, ...(clip.size != null ? { "content-length": String(clip.size) } : {}) },
    });
  } catch (error) {
    return filmError(error);
  }
}

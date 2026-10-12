/**
 *   GET  → a long game video, by HTTP range, for the worker that was given this game.
 *
 * The worker reads a game's video with OpenCV, which seeks: a play at minute 80 is a few megabytes of byte ranges, not
 * the whole file. OpenCV can't send a header, so the job's token is `?t=` here (the other worker routes use a header).
 * The answer is 206 with Content-Range when the store honored the range, else the whole file.
 */

import { NextResponse } from "next/server";
import { filmContext, filmError, workerGate } from "@/lib/film/runtime";
import { openVideoForWorker } from "@/lib/film/service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ team: string; id: string; index: string }> }) {
  const { team, id, index } = await params;
  const refused = workerGate(request, team, id);
  if (refused) return refused;
  if (!/^\d{1,2}$/.test(index)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const video = await openVideoForWorker(filmContext(request), team, id, Number(index), request.headers.get("range"));
    const headers: Record<string, string> = { "content-type": "video/mp4", "accept-ranges": "bytes" };
    if (video.size != null) headers["content-length"] = String(video.size);
    if (video.contentRange) {
      headers["content-range"] = video.contentRange;
      return new Response(video.stream, { status: 206, headers });
    }
    return new Response(video.stream, { status: 200, headers });
  } catch (error) {
    return filmError(error);
  }
}

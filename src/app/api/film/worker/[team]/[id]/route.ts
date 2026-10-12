/**
 * The film worker's reports for one game (see video-service/eval/worker.py):
 *
 *   POST  { type: "clip", index, name, status, reason, formation, strength, seconds }   one clip is done
 *         { type: "assembled", plays }                                                  the game file is uploaded
 *         { type: "failed", error }                                                     the worker gave up
 *
 * Authorized by the job's own token (`x-film-token`), not by a coach's session.
 */

import { NextResponse } from "next/server";
import { filmContext, filmError, workerGate } from "@/lib/film/runtime";
import { handleEvent, type WorkerEvent } from "@/lib/film/service";

export const runtime = "nodejs";
// The last clip's report sends the assemble to the worker before it answers.
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ team: string; id: string }> }) {
  const { team, id } = await params;
  const refused = workerGate(request, team, id);
  if (refused) return refused;
  let event: WorkerEvent;
  try {
    event = (await request.json()) as WorkerEvent;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!event || !["clip", "assembled", "failed"].includes((event as { type?: string }).type ?? "")) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  try {
    return NextResponse.json({ result: await handleEvent(filmContext(request), team, id, event) });
  } catch (error) {
    return filmError(error);
  }
}

/**
 *   POST /api/film/jobs/<id>/start   → once every clip is uploaded: hands the game to the film analyzer.
 */

import { NextResponse } from "next/server";
import { isValidJobId } from "@/lib/film/jobs";
import { filmContext, filmError, filmGate } from "@/lib/film/runtime";
import { startJob } from "@/lib/film/service";

export const runtime = "nodejs";
// Sends each shard to the worker and waits only for its "accepted" answer.
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await filmGate();
  if (gate.error) return gate.error;
  if (!isValidJobId(id)) return NextResponse.json({ error: "not_found", message: "That game isn't in your library." }, { status: 404 });
  try {
    return NextResponse.json({ job: await startJob(filmContext(request), gate.owner, id) });
  } catch (error) {
    return filmError(error);
  }
}

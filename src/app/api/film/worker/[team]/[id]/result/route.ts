/**
 *   PUT  (gzipped JSON) → stores the finished game file. The worker then reports { type: "assembled" }.
 */

import { NextResponse } from "next/server";
import { filmContext, filmError, readWorkerBody, workerGate } from "@/lib/film/runtime";
import { storeResult } from "@/lib/film/service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function PUT(request: Request, { params }: { params: Promise<{ team: string; id: string }> }) {
  const { team, id } = await params;
  const refused = workerGate(request, team, id);
  if (refused) return refused;
  const body = await readWorkerBody(request);
  if (body instanceof NextResponse) return body;
  try {
    return NextResponse.json({ plays: await storeResult(filmContext(request), team, id, body) });
  } catch (error) {
    return filmError(error);
  }
}

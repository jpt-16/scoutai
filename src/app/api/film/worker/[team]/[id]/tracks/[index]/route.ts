/**
 *   PUT  (gzipped JSON) → stores one clip's tracks, for the assemble step
 *   GET                 → the same tracks back, for the assemble step to read
 */

import { NextResponse } from "next/server";
import { filmContext, filmError, readWorkerBody, workerGate } from "@/lib/film/runtime";
import { openForWorker, storeTracks } from "@/lib/film/service";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ team: string; id: string; index: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { team, id, index } = await params;
  const refused = workerGate(request, team, id);
  if (refused) return refused;
  if (!/^\d{1,4}$/.test(index)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = await readWorkerBody(request);
  if (body instanceof NextResponse) return body;
  try {
    await storeTracks(filmContext(request), team, id, Number(index), body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return filmError(error);
  }
}

export async function GET(request: Request, { params }: Params) {
  const { team, id, index } = await params;
  const refused = workerGate(request, team, id);
  if (refused) return refused;
  if (!/^\d{1,4}$/.test(index)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const found = await openForWorker(filmContext(request), team, id, "tracks", Number(index));
    return new Response(found.stream, { headers: { "content-type": found.contentType } });
  } catch (error) {
    return filmError(error);
  }
}

/**
 *   GET    /api/film/jobs/<id>   → the game's status (and, if every clip has reported, nudges the cards along)
 *   PATCH  /api/film/jobs/<id>   { name } → names the game ("" clears it)
 *   DELETE /api/film/jobs/<id>   → deletes the game now: film, tracks, the game file, the record
 */

import { NextResponse } from "next/server";
import { isValidJobId } from "@/lib/film/jobs";
import { filmContext, filmError, filmGate } from "@/lib/film/runtime";
import { deleteJob, getView, renameJob } from "@/lib/film/service";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const gate = await filmGate();
  if (gate.error) return gate.error;
  if (!isValidJobId(id)) return NextResponse.json({ error: "not_found", message: "That game isn't in your library." }, { status: 404 });
  try {
    return NextResponse.json({ job: await getView(filmContext(request), gate.owner, id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return filmError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const gate = await filmGate();
  if (gate.error) return gate.error;
  if (!isValidJobId(id)) return NextResponse.json({ error: "not_found", message: "That game isn't in your library." }, { status: 404 });
  try {
    await deleteJob(filmContext(request), gate.owner, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return filmError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const gate = await filmGate();
  if (gate.error) return gate.error;
  if (!isValidJobId(id)) return NextResponse.json({ error: "not_found", message: "That game isn't in your library." }, { status: 404 });
  let body: { name?: unknown };
  try {
    body = (await request.json()) as { name?: unknown };
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Expected JSON." }, { status: 400 });
  }
  try {
    return NextResponse.json({ job: await renameJob(filmContext(request), gate.owner, id, body.name) });
  } catch (error) {
    return filmError(error);
  }
}

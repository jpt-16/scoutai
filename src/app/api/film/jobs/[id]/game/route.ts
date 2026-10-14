/**
 *   GET /api/film/jobs/<id>/game   → the game's cards: the staff's saved copy once there is one, else the film's own game file.
 *   PUT /api/film/jobs/<id>/game   → saves the staff's copy (the stored script's JSON, gzipped or plain) → { job }
 */

import { NextResponse } from "next/server";
import { isValidJobId } from "@/lib/film/jobs";
import { filmContext, filmError, filmGate } from "@/lib/film/runtime";
import { MAX_SAVED_GAME_BYTES, openGame, saveGameCards } from "@/lib/film/service";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await filmGate();
  if (gate.error) return gate.error;
  if (!isValidJobId(id)) return NextResponse.json({ error: "not_found", message: "That game isn't in your library." }, { status: 404 });
  try {
    const game = await openGame(filmContext(request), gate.owner, id);
    return new Response(game.stream, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (error) {
    return filmError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await filmGate();
  if (gate.error) return gate.error;
  if (!isValidJobId(id)) return NextResponse.json({ error: "not_found", message: "That game isn't in your library." }, { status: 404 });
  const tooBig = NextResponse.json({ error: "too_big", message: "This game is too big to save to your staff." }, { status: 413 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_SAVED_GAME_BYTES) return tooBig;
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_SAVED_GAME_BYTES) return tooBig;
  try {
    return NextResponse.json({ job: await saveGameCards(filmContext(request), gate.owner, id, body) });
  } catch (error) {
    return filmError(error);
  }
}

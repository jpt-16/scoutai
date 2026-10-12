/**
 *   GET /api/film/jobs/<id>/game   → the finished game file (what the landing page's "Open a game file" reads).
 */

import { NextResponse } from "next/server";
import { isValidJobId } from "@/lib/film/jobs";
import { filmContext, filmError, filmGate } from "@/lib/film/runtime";
import { openGame } from "@/lib/film/service";

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

/**
 * The daily sweep (a Vercel Cron, see vercel.json): uploaded film is deleted `CLIP_RETENTION_DAYS` after a game
 * is uploaded, abandoned uploads are removed, and a game the worker never finished is marked failed. The
 * finished game file stays. Vercel sends `Authorization: Bearer $CRON_SECRET`.
 */

import { NextResponse } from "next/server";
import { filmContext, filmError } from "@/lib/film/runtime";
import { cleanup } from "@/lib/film/service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: "film_unavailable" }, { status: 501 });
  try {
    return NextResponse.json(await cleanup(filmContext(request)));
  } catch (error) {
    return filmError(error);
  }
}

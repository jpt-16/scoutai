/**
 * The staff's shared copy of the script, playbook and playsheet.
 *
 *   GET /api/sync?slot=script[&etag=<the copy you have>]
 *       200 the gzipped (or plain) JSON, with its version in `x-sync-etag`
 *       204 nothing saved yet · 304 you're up to date
 *   PUT /api/sync?slot=script[&base=<the copy you last saw>]   (body: the JSON, gzipped)
 *       200 { etag } saved · 409 someone saved since you looked · 413 too big
 *
 * Everyone on the same team (the Clerk organization) reads and writes the same
 * copy; a coach without a team has one of their own. Same access check as the AI
 * routes. Never runs on the open preview/local bypass: it would be one shared
 * copy for anyone holding the URL.
 */

import { NextResponse } from "next/server";
import { requireEntitlement } from "@/lib/entitlement";
import { isAiGateDisabled } from "@/lib/featureFlags";
import { isSyncSlot } from "@/lib/syncMeta";
import { MAX_SYNC_BYTES, readSlot, writeSlot } from "@/lib/syncStore";

export const runtime = "nodejs";

async function gate(): Promise<{ owner: string; error?: undefined } | { error: NextResponse; owner?: undefined }> {
  if (isAiGateDisabled()) {
    return { error: NextResponse.json({ error: "sync_off", message: "Saving to your staff is off here." }, { status: 403 }) };
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { error: NextResponse.json({ error: "sync_unavailable", message: "Storage isn't set up." }, { status: 501 }) };
  }
  const access = await requireEntitlement();
  if (!access.ok) {
    return { error: NextResponse.json({ error: access.error, message: access.message }, { status: access.status }) };
  }
  return { owner: access.teamId };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slot = url.searchParams.get("slot");
  if (!isSyncSlot(slot)) return NextResponse.json({ error: "bad_slot" }, { status: 400 });
  const checked = await gate();
  if (checked.error) return checked.error;

  try {
    const found = await readSlot(checked.owner, slot, url.searchParams.get("etag"));
    if (found.kind === "none") return new Response(null, { status: 204 });
    if (found.kind === "unchanged") return new Response(null, { status: 304 });
    return new Response(Buffer.from(found.body), {
      status: 200,
      headers: {
        "content-type": found.contentType,
        "x-sync-etag": found.etag,
        "x-sync-updated": found.updatedAt,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("sync GET failed", error);
    return NextResponse.json({ error: "sync_failed", message: "Could not reach the staff's copy." }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  const url = new URL(request.url);
  const slot = url.searchParams.get("slot");
  if (!isSyncSlot(slot)) return NextResponse.json({ error: "bad_slot" }, { status: 400 });
  const checked = await gate();
  if (checked.error) return checked.error;

  const tooBig = NextResponse.json({ error: "too_big", message: "This is too big to save to your staff." }, { status: 413 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_SYNC_BYTES) return tooBig;
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength === 0) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (body.byteLength > MAX_SYNC_BYTES) return tooBig;
  const type = request.headers.get("content-type") === "application/gzip" ? "application/gzip" : "application/json";

  try {
    const written = await writeSlot(checked.owner, slot, body, type, url.searchParams.get("base") || null);
    if (written.kind === "conflict") {
      return NextResponse.json({ error: "conflict", message: "Your staff saved a newer copy." }, { status: 409 });
    }
    return NextResponse.json({ etag: written.etag });
  } catch (error) {
    console.error("sync PUT failed", error);
    return NextResponse.json({ error: "sync_failed", message: "Could not save to your staff." }, { status: 502 });
  }
}

/**
 * Whether the signed-in coach can use the AI features right now, answered by
 * the same `requireEntitlement()` the paid routes run, so the upload buttons
 * never disagree with the server (the org's subscription status is visible to
 * the client, but the `AI_ALLOWED_EMAILS` allow-list is not). Costs nothing.
 * Also returns the tier's limits (src/lib/usageLimits.ts), so the batch
 * uploader can refuse an over-limit game before uploading any clips.
 */

import { NextResponse } from "next/server";
import { requireEntitlement } from "@/lib/entitlement";
import { TIER_LIMITS } from "@/lib/usageLimits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const entitlement = await requireEntitlement();
  return NextResponse.json(
    entitlement.ok
      ? { ok: true, tier: entitlement.tier, limits: TIER_LIMITS[entitlement.tier] }
      : { ok: false, error: entitlement.error, message: entitlement.message },
    { headers: { "Cache-Control": "no-store" } },
  );
}

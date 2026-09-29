/**
 * Authorizes the client to upload a game clip straight to Vercel Blob
 * storage (so the clip's bytes never pass through this app's own request
 * body — see `/api/parse-video`, which receives just the resulting URL).
 *
 * This is boilerplate Vercel Blob requires for client-side uploads: without
 * it, the blob store would need to be open to arbitrary public uploads.
 * `@vercel/blob/client`'s `upload()` on the landing page calls this route
 * first to get a signed token, then uploads directly to blob storage.
 */

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { checkRateLimit } from "@vercel/firewall";
import { NextResponse } from "next/server";
import { requireEntitlement } from "@/lib/entitlement";
import { checkBlobRateLimit } from "@/lib/rateLimit";
import { TIER_LIMITS } from "@/lib/usageLimits";

// Every upload here is followed by a paid analysis call, so it has its own
// cap per tier (src/lib/usageLimits.ts `uploads`), sized to fit the clip limit
// plus every running batch's full game so a batch never stalls on uploads. The
// real cost ceilings are the analysis routes' own limits. See
// src/lib/rateLimit.ts for why checkBlobRateLimit is what actually enforces it.

export async function POST(request: Request): Promise<NextResponse> {
  // Middleware already fast-fails an unauthenticated request; this re-check
  // is authoritative and is also what resolves the team id used below.
  const entitlement = await requireEntitlement();
  if (!entitlement.ok) {
    return NextResponse.json(
      { error: entitlement.error, message: entitlement.message },
      { status: entitlement.status },
    );
  }

  const { rateLimited } = await checkRateLimit("blob-upload", { request });
  const { limit, windowMs } = TIER_LIMITS[entitlement.tier].uploads;
  const { ok } = await checkBlobRateLimit(`blob-upload-${entitlement.tier}`, entitlement.teamId, limit, windowMs);
  if (rateLimited || !ok) {
    return NextResponse.json(
      { error: "Too many uploads recently. Wait a few minutes and try again." },
      { status: 429 },
    );
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["video/mp4", "video/quicktime", "video/x-m4v"],
        addRandomSuffix: true,
        // A single play is seconds long — cap well below what a full cutup
        // would need, since bigger clips mean bigger Gemini bills.
        maximumSizeInBytes: 75 * 1024 * 1024,
      }),
      onUploadCompleted: async ({ blob }) => {
        // No app-side record needed — /api/parse-video fetches the blob URL
        // directly once the client calls it. Logged only for visibility.
        console.log("video-service: upload completed", blob.url);
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    // handleUpload throws on an invalid/expired token or a disallowed content type.
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

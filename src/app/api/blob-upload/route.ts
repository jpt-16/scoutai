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
import { checkBlobRateLimit, clientIp } from "@/lib/rateLimit";

// Every upload here is normally followed by a paid /api/parse-video call, so
// this gets its own cap too, a bit looser than that route's. See
// src/lib/rateLimit.ts for why checkBlobRateLimit, not just checkRateLimit,
// is what actually enforces this.
const BLOB_UPLOAD_RATE_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 }; // 5 per 10 minutes per IP

export async function POST(request: Request): Promise<NextResponse> {
  const { rateLimited } = await checkRateLimit("blob-upload", { request });
  const { ok } = await checkBlobRateLimit(
    "blob-upload",
    clientIp(request),
    BLOB_UPLOAD_RATE_LIMIT.limit,
    BLOB_UPLOAD_RATE_LIMIT.windowMs,
  );
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

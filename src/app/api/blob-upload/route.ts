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
import { NextResponse } from "next/server";

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["video/mp4", "video/quicktime", "video/x-m4v"],
        addRandomSuffix: true,
        // A generous cap for a single-play clip; adjust if coaches upload longer cutups.
        maximumSizeInBytes: 250 * 1024 * 1024,
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

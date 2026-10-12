/**
 * Authorizes the browser to upload one clip of a game straight to the private store (the film never passes
 * through this app's own request body). It will only sign the exact paths `POST /api/film/jobs` handed out,
 * for this staff, while the game is waiting for its clips, at no more than the size the coach declared.
 */

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { filmContext, filmError, filmGate } from "@/lib/film/runtime";
import { authorizeUpload } from "@/lib/film/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const gate = await filmGate();
  if (gate.error) return gate.error;
  const ctx = filmContext(request);
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Expected JSON." }, { status: 400 });
  }
  try {
    const answer = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const { maxBytes } = await authorizeUpload(ctx, gate.owner, pathname);
        return {
          allowedContentTypes: ["video/mp4", "video/quicktime", "video/x-m4v"],
          addRandomSuffix: false,
          // A retry after a dropped connection writes the same path again.
          allowOverwrite: true,
          maximumSizeInBytes: maxBytes,
        };
      },
    });
    return NextResponse.json(answer);
  } catch (error) {
    // authorizeUpload's refusals keep their reason; anything else from handleUpload (a bad or expired token) is a 400.
    if (error instanceof Error && "status" in error) return filmError(error);
    return NextResponse.json({ error: "upload_refused", message: (error as Error).message }, { status: 400 });
  }
}

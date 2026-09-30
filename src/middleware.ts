/**
 * Bare Clerk session middleware — required for `auth()`/`clerkClient()` to
 * have request context in the route handlers that call them
 * (/api/parse-video, /api/parse-video-batch, /api/generate-scout-card, /api/blob-upload,
 * /api/stripe/checkout, /api/stripe/portal). It does no route gating itself: `createRouteMatcher`
 * + auth.protect() is Clerk's own now-deprecated pattern in favor of
 * resource-based checks, so the actual sign-in/entitlement check happens
 * inside each route handler via src/lib/entitlement.ts's
 * `requireEntitlement()`, not here.
 *
 * The matcher is scoped to only the routes above (plus /account, reserved
 * for a future account page) so this never runs on `/` or `/script` — the
 * free CSV path has no Clerk dependency at all.
 */

import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isClerkConfigured } from "@/lib/clerkConfig";

export default isClerkConfigured()
  ? clerkMiddleware()
  : function middleware() {
      return NextResponse.next();
    };

export const config = {
  matcher: [
    "/api/parse-video",
    "/api/parse-video-batch",
    "/api/generate-scout-card",
    "/api/ai-access",
    "/api/review-import",
    "/api/read-secondary",
    "/api/blob-upload",
    "/api/stripe/checkout",
    "/api/stripe/portal",
    "/account/:path*",
  ],
};

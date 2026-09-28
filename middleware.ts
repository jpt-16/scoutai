/**
 * Refreshes the Supabase session cookie and fast-fails unauthenticated
 * requests to the paid video-analysis routes, before any Blob/Gemini work
 * (or even the rate limiter) runs. Scoped narrowly via `matcher` below so it
 * never executes on `/` or `/script` — the free CSV path stays untouched.
 *
 * This is the cheap first layer only. Each gated route re-checks with
 * `requireEntitlement()` (team membership + subscription status), since a
 * money-costing call shouldn't trust middleware alone.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_API_ROUTES = ["/api/parse-video", "/api/blob-upload"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() revalidates against Supabase rather than trusting a possibly
  // stale/tampered cookie, unlike getSession().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtectedApiRoute = PROTECTED_API_ROUTES.some((route) =>
    request.nextUrl.pathname.startsWith(route),
  );

  if (isProtectedApiRoute && !user) {
    return NextResponse.json(
      { error: "sign_in_required", message: "Sign in to upload film." },
      { status: 401 },
    );
  }

  return response;
}

export const config = {
  matcher: ["/api/parse-video", "/api/blob-upload", "/invite/:path*", "/account/:path*"],
};

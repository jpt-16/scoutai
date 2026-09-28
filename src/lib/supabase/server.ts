/**
 * Supabase client for Route Handlers and Server Components, bound to the
 * request's cookies so `auth.getUser()` can read/refresh the session.
 *
 * Next.js 15 made `cookies()` async — this is a real gotcha copying older
 * Supabase examples written against Next 13/14, which called it synchronously.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component that can't set cookies — the
            // session is still refreshed by middleware, so this is safe to ignore.
          }
        },
      },
    },
  );
}

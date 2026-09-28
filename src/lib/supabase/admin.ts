/**
 * Service-role Supabase client that bypasses RLS entirely. Imported ONLY by
 * the Stripe webhook (to write subscription state onto `teams` without a
 * user session) and server-side RPC callers that need elevated writes.
 *
 * Never import this from anything reachable by the client bundle.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

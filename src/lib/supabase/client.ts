/**
 * Supabase client for Client Components (the sign-in dialog, account menu,
 * and the video-upload card's own auth-state check). Only the paid video
 * feature uses Supabase — the free CSV path never imports this.
 */

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

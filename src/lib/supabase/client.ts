/**
 * Supabase client for Client Components (the sign-in dialog, account menu,
 * and the video-upload card's own auth-state check). Only the paid video
 * feature uses Supabase — the free CSV path never imports this.
 */

import { createBrowserClient } from "@supabase/ssr";

/**
 * True once the Supabase env vars are set. Before that (e.g. this app
 * deployed without the video feature configured yet), every auth-related
 * component must degrade to "signed out" rather than call `createClient()` —
 * `createBrowserClient` throws synchronously on a missing URL/key, which
 * would otherwise crash the whole page, including the free CSV path.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

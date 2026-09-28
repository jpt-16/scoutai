"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export interface TeamAccountTeam {
  id: string;
  name: string;
  subscriptionStatus: string | null;
}

export interface TeamAccountState {
  loading: boolean;
  user: User | null;
  team: TeamAccountTeam | null;
  /** Mirrors the check in src/lib/entitlement.ts — kept in sync by hand, not imported (that module is server-only). */
  entitled: boolean;
  /** False until the Supabase env vars are set — callers should treat this like a permanent signed-out state, not prompt to sign in. */
  configured: boolean;
  refresh: () => void;
}

/**
 * Client-side mirror of the account/entitlement state used by both
 * `AccountMenu` and the video-upload card on the landing page, so they don't
 * each independently query Supabase and can react together to sign-in/out.
 */
export function useTeamAccount(): TeamAccountState {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [team, setTeam] = useState<TeamAccountTeam | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    const supabase = createClient();
    let cancelled = false;

    async function load() {
      setLoading(true);
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      setUser(currentUser);

      if (!currentUser) {
        setTeam(null);
        setLoading(false);
        return;
      }

      const { data: membership } = await supabase
        .from("team_members")
        .select("team_id, teams (id, name, subscription_status)")
        .eq("user_id", currentUser.id)
        .limit(1)
        .maybeSingle<{
          team_id: string;
          teams: { id: string; name: string; subscription_status: string | null } | null;
        }>();

      if (cancelled) return;
      setTeam(
        membership?.teams
          ? {
              id: membership.teams.id,
              name: membership.teams.name,
              subscriptionStatus: membership.teams.subscription_status,
            }
          : null,
      );
      setLoading(false);
    }

    load();
    const { data: subscription } = supabase.auth.onAuthStateChange(() => refresh());

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [nonce, refresh]);

  const entitled = team?.subscriptionStatus === "active" || team?.subscriptionStatus === "trialing";

  return { loading, user, team, entitled, configured: isSupabaseConfigured(), refresh };
}

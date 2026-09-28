/**
 * Gates the two video-analysis routes behind "signed in, on a team, team has
 * an active subscription." `evaluateEntitlement` is the pure decision (unit
 * tested without touching Supabase); `requireEntitlement` is the thin I/O
 * wrapper each route calls first, before any Blob/Gemini work.
 */

import { createClient } from "./supabase/server";

export type EntitlementResult =
  | { ok: true; userId: string; teamId: string }
  | { ok: false; status: 401 | 402 | 403; error: string; message: string };

export function evaluateEntitlement(input: {
  userId: string | null;
  team: { id: string; subscriptionStatus: string | null } | null;
}): EntitlementResult {
  if (!input.userId) {
    return { ok: false, status: 401, error: "sign_in_required", message: "Sign in to upload film." };
  }
  if (!input.team) {
    return {
      ok: false,
      status: 403,
      error: "no_team",
      message: "Create or join a coaching staff team first.",
    };
  }
  if (input.team.subscriptionStatus !== "active" && input.team.subscriptionStatus !== "trialing") {
    return {
      ok: false,
      status: 402,
      error: "subscription_required",
      message: "Your team's subscription isn't active. Subscribe to unlock AI film import.",
    };
  }
  return { ok: true, userId: input.userId, teamId: input.team.id };
}

export async function requireEntitlement(): Promise<EntitlementResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return evaluateEntitlement({ userId: null, team: null });
  }

  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id, teams (id, subscription_status)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle<{ team_id: string; teams: { id: string; subscription_status: string | null } | null }>();

  const team = membership?.teams
    ? { id: membership.teams.id, subscriptionStatus: membership.teams.subscription_status }
    : null;

  return evaluateEntitlement({ userId: user.id, team });
}

"use client";

import { useEffect, useState } from "react";
import { useAuth, useOrganization } from "@clerk/nextjs";

export interface TeamAccountTeam {
  id: string;
  name: string;
  subscriptionStatus: string | null;
}

export interface TeamAccountState {
  loading: boolean;
  userId: string | null;
  team: TeamAccountTeam | null;
  /**
   * Can use the AI features: the team's subscription (visible right away), or
   * the server's own answer from /api/ai-access, which also knows the
   * AI_ALLOWED_EMAILS allow-list the client can't see.
   */
  entitled: boolean;
  /** The server couldn't be asked (offline on the practice field, say): `entitled` is unknown. */
  accessCheckFailed: boolean;
}

/**
 * Client-side mirror of the account/entitlement state used by both
 * `AccountMenu` and the video-upload card. Thin wrapper over Clerk's own
 * hooks — Clerk keeps them reactive on sign-in/out and org switches, so
 * there's no manual fetching or refresh() needed here (unlike the old
 * Supabase version this replaces).
 *
 * Only ever call this from a component that's guaranteed to render inside
 * <ClerkProvider> (i.e. gated by `isClerkConfigured()` first) — Clerk's
 * hooks throw otherwise.
 */
export function useTeamAccount(): TeamAccountState {
  const { isLoaded: authLoaded, userId } = useAuth();
  const { isLoaded: orgLoaded, organization } = useOrganization();

  const loading = !authLoaded || !orgLoaded;

  const team: TeamAccountTeam | null = organization
    ? {
        id: organization.id,
        name: organization.name,
        subscriptionStatus:
          (organization.publicMetadata as { subscriptionStatus?: string | null }).subscriptionStatus ?? null,
      }
    : null;

  const subscribed = team?.subscriptionStatus === "active" || team?.subscriptionStatus === "trialing";

  // Ask the server once per signed-in user + team.
  const key = userId ? `${userId}:${organization?.id ?? ""}` : null;
  const [serverAccess, setServerAccess] = useState<{ key: string; ok: boolean; failed?: boolean } | null>(
    null,
  );
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetch("/api/ai-access", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { ok?: boolean }) => !cancelled && setServerAccess({ key, ok: body.ok === true }))
      .catch(() => !cancelled && setServerAccess({ key, ok: false, failed: true }));
    return () => {
      cancelled = true;
    };
  }, [key]);
  const checked = !key || subscribed || serverAccess?.key === key;
  const entitled = subscribed || (serverAccess?.key === key && serverAccess.ok);

  const accessCheckFailed = serverAccess?.key === key && serverAccess.failed === true;

  return { loading: loading || !checked, userId: userId ?? null, team, entitled, accessCheckFailed };
}

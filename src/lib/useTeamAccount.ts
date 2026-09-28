"use client";

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
  /** Mirrors the check in src/lib/entitlement.ts — kept in sync by hand, not imported (that module is server-only). */
  entitled: boolean;
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

  const entitled = team?.subscriptionStatus === "active" || team?.subscriptionStatus === "trialing";

  return { loading, userId: userId ?? null, team, entitled };
}

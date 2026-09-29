/**
 * Gates the two video-analysis routes behind "signed in, on a team, team has
 * an active subscription." `evaluateEntitlement` is the pure decision (unit
 * tested without touching Clerk); `requireEntitlement` is the thin I/O
 * wrapper each route calls first, before any Blob/Gemini work.
 *
 * "Team" here is a Clerk Organization — `orgId` is only present in `auth()`
 * once the signed-in user has an active org selected, which is exactly
 * "on a team." Subscription state lives in the org's `publicMetadata`
 * (written by the Stripe webhook via `clerkClient`), not a separate database.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { isClerkConfigured } from "./clerkConfig";
import { isAiGateDisabled } from "./featureFlags";
import type { AccessTier } from "./usageLimits";

export type EntitlementResult =
  | { ok: true; userId: string; teamId: string; tier: AccessTier }
  | { ok: false; status: 401 | 402 | 403; error: string; message: string };

export function evaluateEntitlement(input: {
  userId: string | null;
  team: { id: string; subscriptionStatus: string | null } | null;
}): EntitlementResult {
  if (!input.userId) {
    return { ok: false, status: 401, error: "sign_in_required", message: "Sign in to use the AI features." };
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
      message: "Your team's subscription isn't active. Subscribe to unlock the AI features.",
    };
  }
  return { ok: true, userId: input.userId, teamId: input.team.id, tier: "paid" };
}

/**
 * Whether any of a user's verified emails is on the free allow-list: the
 * `AI_ALLOWED_EMAILS` env var, comma-separated. Temporary access for the
 * owner's own staff before billing is live; delete the env var and the
 * subscription gate applies to everyone again.
 */
export function isAllowListed(verifiedEmails: string[], allowList: string | undefined): boolean {
  const allowed = new Set(
    (allowList ?? "")
      .split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
  return allowed.size > 0 && verifiedEmails.some((e) => allowed.has(e.trim().toLowerCase()));
}

export async function requireEntitlement(): Promise<EntitlementResult> {
  // Testing-only escape hatch — see src/lib/featureFlags.ts for the safety
  // conditions (local-only in practice, a no-op on Vercel production).
  if (isAiGateDisabled()) {
    return { ok: true, userId: "test-bypass", teamId: "test-bypass", tier: "demo" };
  }

  // No Clerk keys on this deployment: nobody can sign in, so nobody is entitled
  // (and auth() would throw without its middleware).
  if (!isClerkConfigured()) return evaluateEntitlement({ userId: null, team: null });

  const { userId, orgId } = await auth();

  if (!userId) return evaluateEntitlement({ userId, team: null });

  const clerk = await clerkClient();

  // A subscribed staff gets the paid tier, even if a coach is also allow-listed.
  let paid: EntitlementResult | null = null;
  if (orgId) {
    const org = await clerk.organizations.getOrganization({ organizationId: orgId });
    const subscriptionStatus =
      (org.publicMetadata as { subscriptionStatus?: string | null }).subscriptionStatus ?? null;
    paid = evaluateEntitlement({ userId, team: { id: orgId, subscriptionStatus } });
    if (paid.ok) return paid;
  }

  if (process.env.AI_ALLOWED_EMAILS) {
    const user = await clerk.users.getUser(userId);
    const verified = user.emailAddresses
      .filter((e) => e.verification?.status === "verified")
      .map((e) => e.emailAddress);
    // Allow-listed: the demo tier, no team or subscription needed. Rate limits
    // bucket by team, or by the user when there's no team.
    if (isAllowListed(verified, process.env.AI_ALLOWED_EMAILS)) {
      return { ok: true, userId, teamId: orgId ?? `user-${userId}`, tier: "demo" };
    }
  }

  return paid ?? evaluateEntitlement({ userId, team: null });
}

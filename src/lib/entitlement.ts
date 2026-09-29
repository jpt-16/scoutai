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

export type EntitlementResult =
  | { ok: true; userId: string; teamId: string }
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
  return { ok: true, userId: input.userId, teamId: input.team.id };
}

export async function requireEntitlement(): Promise<EntitlementResult> {
  // Testing-only escape hatch — see src/lib/featureFlags.ts for the safety
  // conditions (local-only in practice, a no-op on Vercel production).
  if (isAiGateDisabled()) {
    return { ok: true, userId: "test-bypass", teamId: "test-bypass" };
  }

  // No Clerk keys on this deployment: nobody can sign in, so nobody is entitled
  // (and auth() would throw without its middleware).
  if (!isClerkConfigured()) return evaluateEntitlement({ userId: null, team: null });

  const { userId, orgId } = await auth();

  if (!userId || !orgId) {
    return evaluateEntitlement({ userId, team: null });
  }

  const clerk = await clerkClient();
  const org = await clerk.organizations.getOrganization({ organizationId: orgId });
  const subscriptionStatus = (org.publicMetadata as { subscriptionStatus?: string | null })
    .subscriptionStatus ?? null;

  return evaluateEntitlement({ userId, team: { id: orgId, subscriptionStatus } });
}

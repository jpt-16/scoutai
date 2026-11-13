/**
 * Pure mapping from a Stripe webhook event to the metadata patch that should
 * land on a Clerk Organization. Kept separate from the webhook route's
 * signature verification and Clerk write so it's unit-testable with
 * hand-built fixture JSON — no live webhook secret or network call needed.
 *
 * Every event this app cares about carries `org_id` (a Clerk organization
 * id) in its Stripe metadata, set once at Checkout (`/api/stripe/checkout`)
 * on both the session and the subscription — so matching is always by
 * `org_id`, never by `stripe_customer_id`/`stripe_subscription_id` (which
 * aren't written onto the org until the first `checkout.session.completed`
 * actually lands).
 */

import type Stripe from "stripe";

export interface OrgBillingPatch {
  orgId: string;
  /** Client-readable via useOrganization() — drives src/lib/entitlement.ts and the UI. */
  publicMetadata: {
    subscriptionStatus?: string;
    subscriptionCurrentPeriodEnd?: string | null;
    subscriptionPriceId?: string | null;
  };
  /** Server-only — used by the Checkout/Portal routes to find the existing Stripe customer. */
  privateMetadata: {
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    /** `event.created` of the last status event applied (set by the webhook route, see `isStaleBillingEvent`). */
    stripeEventAt?: number;
  };
}

function periodEndToIso(subscription: Stripe.Subscription): string | null {
  const item = subscription.items.data[0];
  const periodEnd = item?.current_period_end;
  return typeof periodEnd === "number" ? new Date(periodEnd * 1000).toISOString() : null;
}

function priceIdOf(subscription: Stripe.Subscription): string | null {
  return subscription.items.data[0]?.price?.id ?? null;
}

/** Returns the org patch for a Stripe event, or `null` for event types (or malformed events) this app ignores. */
export function mapStripeEventToOrgPatch(event: Stripe.Event): OrgBillingPatch | null {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata?.org_id;
      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (!orgId || !customerId || !subscriptionId) return null;

      return {
        orgId,
        publicMetadata: {},
        privateMetadata: { stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId },
      };
    }

    case "customer.subscription.updated":
    case "customer.subscription.created": {
      const subscription = event.data.object as Stripe.Subscription;
      const orgId = subscription.metadata?.org_id;
      if (!orgId) return null;
      const customerId =
        typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

      return {
        orgId,
        publicMetadata: {
          subscriptionStatus: subscription.status,
          subscriptionCurrentPeriodEnd: periodEndToIso(subscription),
          subscriptionPriceId: priceIdOf(subscription),
        },
        privateMetadata: { stripeCustomerId: customerId, stripeSubscriptionId: subscription.id },
      };
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const orgId = subscription.metadata?.org_id;
      if (!orgId) return null;

      return { orgId, publicMetadata: { subscriptionStatus: "canceled" }, privateMetadata: {} };
    }

    default:
      return null;
  }
}

/**
 * Stripe doesn't promise to deliver events in the order they happened, and it retries a failed one for days:
 * an old `customer.subscription.updated` ("active") that lands after `customer.subscription.deleted` would
 * switch a cancelled staff back on. Each status write records its event's time (`stripeEventAt`, seconds, from
 * `event.created`), and an event older than the last one written is ignored. Equal times are applied in the
 * order they arrive.
 */
export function isStaleBillingEvent(storedEventAt: unknown, eventCreated: number): boolean {
  return typeof storedEventAt === "number" && Number.isFinite(storedEventAt) && eventCreated < storedEventAt;
}

/** Statuses where Stripe still holds a subscription for the staff, so starting a second Checkout would bill twice. */
const LIVE_SUBSCRIPTION = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);

export function hasLiveSubscription(status: unknown): boolean {
  return typeof status === "string" && LIVE_SUBSCRIPTION.has(status);
}

/** The two Clerk organization calls the webhook makes (so a test can stand in for Clerk). */
export interface BillingOrgStore {
  getOrganization(params: { organizationId: string }): Promise<{ privateMetadata: object }>;
  updateOrganizationMetadata(
    organizationId: string,
    params: { publicMetadata?: OrgBillingPatch["publicMetadata"]; privateMetadata?: OrgBillingPatch["privateMetadata"] },
  ): Promise<unknown>;
}

/**
 * Writes a Stripe event's billing state onto its organization, unless it is one this app ignores or a status
 * event older than the last one applied (`isStaleBillingEvent`). Throws what Clerk throws, so the webhook can
 * answer 500 and Stripe retries.
 */
export async function applyBillingEvent(orgs: BillingOrgStore, event: Stripe.Event): Promise<"applied" | "stale" | "ignored"> {
  const patch = mapStripeEventToOrgPatch(event);
  if (!patch) return "ignored";
  const privateMetadata = { ...patch.privateMetadata };
  if (patch.publicMetadata.subscriptionStatus !== undefined) {
    const org = await orgs.getOrganization({ organizationId: patch.orgId });
    if (isStaleBillingEvent((org.privateMetadata as { stripeEventAt?: unknown }).stripeEventAt, event.created)) return "stale";
    privateMetadata.stripeEventAt = event.created;
  }
  // updateOrganizationMetadata deep-merges, so this never clobbers other metadata keys the org might hold.
  await orgs.updateOrganizationMetadata(patch.orgId, { publicMetadata: patch.publicMetadata, privateMetadata });
  return "applied";
}

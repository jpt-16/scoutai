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

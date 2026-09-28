/**
 * Pure mapping from a Stripe webhook event to the patch that should land on
 * a `teams` row. Kept separate from the webhook route's signature
 * verification and Supabase write so it's unit-testable with hand-built
 * fixture JSON — no live webhook secret or network call needed.
 *
 * Matching prefers `team_id` (set as Checkout/subscription metadata by
 * `/api/stripe/checkout`) over `stripe_customer_id`: on the very first
 * `checkout.session.completed` event, the team's `stripe_customer_id` column
 * isn't populated yet, so customer-id matching would find nothing. Falling
 * back to customer/subscription id still covers events where metadata is
 * somehow missing.
 */

import type Stripe from "stripe";

export interface TeamBillingPatch {
  matchOn:
    | { teamId: string }
    | { stripeCustomerId: string }
    | { stripeSubscriptionId: string };
  patch: {
    stripe_customer_id?: string;
    stripe_subscription_id?: string;
    subscription_status?: string;
    subscription_current_period_end?: string | null;
    subscription_price_id?: string | null;
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

/** Returns the `teams` patch for a Stripe event, or `null` for event types this app ignores. */
export function mapStripeEventToTeamPatch(event: Stripe.Event): TeamBillingPatch | null {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      const teamId = session.metadata?.team_id ?? session.client_reference_id ?? undefined;
      if (!customerId || !subscriptionId || !teamId) return null;

      return {
        matchOn: { teamId },
        patch: {
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
        },
      };
    }

    case "customer.subscription.updated":
    case "customer.subscription.created": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
      const teamId = subscription.metadata?.team_id;

      return {
        matchOn: teamId ? { teamId } : { stripeCustomerId: customerId },
        patch: {
          stripe_customer_id: customerId,
          stripe_subscription_id: subscription.id,
          subscription_status: subscription.status,
          subscription_current_period_end: periodEndToIso(subscription),
          subscription_price_id: priceIdOf(subscription),
        },
      };
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const teamId = subscription.metadata?.team_id;
      return {
        matchOn: teamId ? { teamId } : { stripeSubscriptionId: subscription.id },
        patch: { subscription_status: "canceled" },
      };
    }

    default:
      return null;
  }
}

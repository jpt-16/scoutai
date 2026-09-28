import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { mapStripeEventToTeamPatch } from "./stripeWebhook";

function fakeEvent(type: string, object: unknown): Stripe.Event {
  return { type, data: { object } } as unknown as Stripe.Event;
}

describe("mapStripeEventToTeamPatch", () => {
  it("maps checkout.session.completed by team_id metadata (the team has no stripe_customer_id yet)", () => {
    const event = fakeEvent("checkout.session.completed", {
      customer: "cus_123",
      subscription: "sub_456",
      metadata: { team_id: "team-1" },
    });

    expect(mapStripeEventToTeamPatch(event)).toEqual({
      matchOn: { teamId: "team-1" },
      patch: { stripe_customer_id: "cus_123", stripe_subscription_id: "sub_456" },
    });
  });

  it("falls back to client_reference_id when checkout metadata is missing", () => {
    const event = fakeEvent("checkout.session.completed", {
      customer: "cus_123",
      subscription: "sub_456",
      client_reference_id: "team-1",
    });

    expect(mapStripeEventToTeamPatch(event)?.matchOn).toEqual({ teamId: "team-1" });
  });

  it("ignores a checkout session with no team id at all", () => {
    const event = fakeEvent("checkout.session.completed", { customer: "cus_123", subscription: "sub_456" });
    expect(mapStripeEventToTeamPatch(event)).toBeNull();
  });

  it("maps customer.subscription.updated by team_id metadata, with the full status patch", () => {
    const event = fakeEvent("customer.subscription.updated", {
      id: "sub_456",
      customer: "cus_123",
      status: "active",
      metadata: { team_id: "team-1" },
      items: {
        data: [
          {
            current_period_end: 1_700_000_000,
            price: { id: "price_abc" },
          },
        ],
      },
    });

    expect(mapStripeEventToTeamPatch(event)).toEqual({
      matchOn: { teamId: "team-1" },
      patch: {
        stripe_customer_id: "cus_123",
        stripe_subscription_id: "sub_456",
        subscription_status: "active",
        subscription_current_period_end: new Date(1_700_000_000 * 1000).toISOString(),
        subscription_price_id: "price_abc",
      },
    });
  });

  it("falls back to customer id when subscription metadata has no team_id", () => {
    const event = fakeEvent("customer.subscription.updated", {
      id: "sub_456",
      customer: "cus_123",
      status: "active",
      items: { data: [] },
    });

    expect(mapStripeEventToTeamPatch(event)?.matchOn).toEqual({ stripeCustomerId: "cus_123" });
  });

  it("maps customer.subscription.deleted to a canceled status, matched by team_id", () => {
    const event = fakeEvent("customer.subscription.deleted", {
      id: "sub_456",
      customer: "cus_123",
      metadata: { team_id: "team-1" },
    });

    expect(mapStripeEventToTeamPatch(event)).toEqual({
      matchOn: { teamId: "team-1" },
      patch: { subscription_status: "canceled" },
    });
  });

  it("falls back to subscription id when a deleted event has no team_id metadata", () => {
    const event = fakeEvent("customer.subscription.deleted", { id: "sub_456", customer: "cus_123" });
    expect(mapStripeEventToTeamPatch(event)?.matchOn).toEqual({ stripeSubscriptionId: "sub_456" });
  });

  it("ignores event types this app doesn't handle", () => {
    const event = fakeEvent("invoice.paid", {});
    expect(mapStripeEventToTeamPatch(event)).toBeNull();
  });
});

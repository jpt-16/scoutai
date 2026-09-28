import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { mapStripeEventToOrgPatch } from "./stripeWebhook";

function fakeEvent(type: string, object: unknown): Stripe.Event {
  return { type, data: { object } } as unknown as Stripe.Event;
}

describe("mapStripeEventToOrgPatch", () => {
  it("maps checkout.session.completed to the customer/subscription ids, matched by org_id", () => {
    const event = fakeEvent("checkout.session.completed", {
      customer: "cus_123",
      subscription: "sub_456",
      metadata: { org_id: "org_1" },
    });

    expect(mapStripeEventToOrgPatch(event)).toEqual({
      orgId: "org_1",
      publicMetadata: {},
      privateMetadata: { stripeCustomerId: "cus_123", stripeSubscriptionId: "sub_456" },
    });
  });

  it("ignores a checkout session missing org_id metadata", () => {
    const event = fakeEvent("checkout.session.completed", { customer: "cus_123", subscription: "sub_456" });
    expect(mapStripeEventToOrgPatch(event)).toBeNull();
  });

  it("ignores a checkout session missing a subscription id", () => {
    const event = fakeEvent("checkout.session.completed", {
      customer: "cus_123",
      subscription: null,
      metadata: { org_id: "org_1" },
    });
    expect(mapStripeEventToOrgPatch(event)).toBeNull();
  });

  it("maps customer.subscription.updated to the full status patch", () => {
    const event = fakeEvent("customer.subscription.updated", {
      id: "sub_456",
      customer: "cus_123",
      status: "active",
      metadata: { org_id: "org_1" },
      items: {
        data: [
          {
            current_period_end: 1_700_000_000,
            price: { id: "price_abc" },
          },
        ],
      },
    });

    expect(mapStripeEventToOrgPatch(event)).toEqual({
      orgId: "org_1",
      publicMetadata: {
        subscriptionStatus: "active",
        subscriptionCurrentPeriodEnd: new Date(1_700_000_000 * 1000).toISOString(),
        subscriptionPriceId: "price_abc",
      },
      privateMetadata: { stripeCustomerId: "cus_123", stripeSubscriptionId: "sub_456" },
    });
  });

  it("ignores a subscription event missing org_id metadata", () => {
    const event = fakeEvent("customer.subscription.updated", {
      id: "sub_456",
      customer: "cus_123",
      status: "active",
      items: { data: [] },
    });
    expect(mapStripeEventToOrgPatch(event)).toBeNull();
  });

  it("maps customer.subscription.deleted to a canceled status", () => {
    const event = fakeEvent("customer.subscription.deleted", {
      id: "sub_456",
      customer: "cus_123",
      metadata: { org_id: "org_1" },
    });

    expect(mapStripeEventToOrgPatch(event)).toEqual({
      orgId: "org_1",
      publicMetadata: { subscriptionStatus: "canceled" },
      privateMetadata: {},
    });
  });

  it("ignores event types this app doesn't handle", () => {
    const event = fakeEvent("invoice.paid", {});
    expect(mapStripeEventToOrgPatch(event)).toBeNull();
  });
});

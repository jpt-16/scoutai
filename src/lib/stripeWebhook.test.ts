import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { applyBillingEvent, hasLiveSubscription, isStaleBillingEvent, mapStripeEventToOrgPatch, type BillingOrgStore } from "./stripeWebhook";

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

describe("isStaleBillingEvent", () => {
  it("applies the first status event and any newer or same-second one", () => {
    expect(isStaleBillingEvent(undefined, 1_700_000_000)).toBe(false);
    expect(isStaleBillingEvent(null, 1_700_000_000)).toBe(false);
    expect(isStaleBillingEvent(1_700_000_000, 1_700_000_001)).toBe(false);
    expect(isStaleBillingEvent(1_700_000_000, 1_700_000_000)).toBe(false);
  });

  it("ignores an event older than the one already applied: an old 'active' after the cancellation", () => {
    expect(isStaleBillingEvent(1_700_000_500, 1_700_000_000)).toBe(true);
  });

  it("does not trust a stored value that isn't a time", () => {
    expect(isStaleBillingEvent("1700000500", 1_700_000_000)).toBe(false);
    expect(isStaleBillingEvent(Number.NaN, 1_700_000_000)).toBe(false);
  });
});

describe("hasLiveSubscription", () => {
  it("is true while Stripe still holds a subscription for the staff", () => {
    for (const status of ["active", "trialing", "past_due", "unpaid", "paused"]) expect(hasLiveSubscription(status)).toBe(true);
  });

  it("is false for no subscription or an ended one, so they can subscribe again", () => {
    for (const status of [undefined, null, "", "canceled", "incomplete", "incomplete_expired", 5]) expect(hasLiveSubscription(status)).toBe(false);
  });
});

/** A stand-in for Clerk's organizations: metadata merged the way `updateOrganizationMetadata` does (one level deep is all this app writes). */
function fakeOrgs(initial: { publicMetadata?: Record<string, unknown>; privateMetadata?: Record<string, unknown> } = {}) {
  const org = { publicMetadata: { ...initial.publicMetadata }, privateMetadata: { ...initial.privateMetadata } };
  const writes: unknown[] = [];
  const store: BillingOrgStore = {
    getOrganization: async () => org,
    updateOrganizationMetadata: async (_id, params) => {
      writes.push(params);
      Object.assign(org.publicMetadata, params.publicMetadata);
      Object.assign(org.privateMetadata, params.privateMetadata);
    },
  };
  return { org, writes, store };
}

function subscriptionEvent(type: "customer.subscription.updated" | "customer.subscription.deleted", status: string, created: number): Stripe.Event {
  return {
    type,
    created,
    data: {
      object: {
        id: "sub_456",
        customer: "cus_123",
        status,
        metadata: { org_id: "org_1" },
        items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_abc" } }] },
      },
    },
  } as unknown as Stripe.Event;
}

describe("applyBillingEvent", () => {
  it("applies a subscription event and records when it happened", async () => {
    const { org, store } = fakeOrgs();
    expect(await applyBillingEvent(store, subscriptionEvent("customer.subscription.updated", "active", 1000))).toBe("applied");
    expect(org.publicMetadata).toMatchObject({ subscriptionStatus: "active", subscriptionPriceId: "price_abc" });
    expect(org.privateMetadata).toMatchObject({ stripeCustomerId: "cus_123", stripeSubscriptionId: "sub_456", stripeEventAt: 1000 });
  });

  it("a late, old 'active' does not switch a cancelled staff back on", async () => {
    const { org, writes, store } = fakeOrgs();
    await applyBillingEvent(store, subscriptionEvent("customer.subscription.updated", "active", 1000));
    await applyBillingEvent(store, subscriptionEvent("customer.subscription.deleted", "canceled", 2000));
    expect(org.publicMetadata).toMatchObject({ subscriptionStatus: "canceled" });
    const writesBefore = writes.length;

    // Stripe retries the first event after the cancellation.
    expect(await applyBillingEvent(store, subscriptionEvent("customer.subscription.updated", "active", 1000))).toBe("stale");
    expect(org.publicMetadata).toMatchObject({ subscriptionStatus: "canceled" });
    expect(writes).toHaveLength(writesBefore);
  });

  it("a newer event still wins, so a staff that re-subscribes is switched back on", async () => {
    const { org, store } = fakeOrgs();
    await applyBillingEvent(store, subscriptionEvent("customer.subscription.deleted", "canceled", 2000));
    expect(await applyBillingEvent(store, subscriptionEvent("customer.subscription.updated", "active", 3000))).toBe("applied");
    expect(org.publicMetadata).toMatchObject({ subscriptionStatus: "active" });
  });

  it("an org written before this check existed (no stored time) takes the next event", async () => {
    const { org, store } = fakeOrgs({ publicMetadata: { subscriptionStatus: "active" } });
    expect(await applyBillingEvent(store, subscriptionEvent("customer.subscription.deleted", "canceled", 500))).toBe("applied");
    expect(org.publicMetadata).toMatchObject({ subscriptionStatus: "canceled" });
  });

  it("checkout completion saves the ids without a status, and never blocks a later status event", async () => {
    const { org, store } = fakeOrgs();
    const checkout = fakeEvent("checkout.session.completed", { customer: "cus_123", subscription: "sub_456", metadata: { org_id: "org_1" } });
    (checkout as { created: number }).created = 9000;
    expect(await applyBillingEvent(store, checkout)).toBe("applied");
    expect(org.privateMetadata).toMatchObject({ stripeCustomerId: "cus_123", stripeSubscriptionId: "sub_456" });
    expect(org.privateMetadata).not.toHaveProperty("stripeEventAt");
    expect(await applyBillingEvent(store, subscriptionEvent("customer.subscription.updated", "active", 1000))).toBe("applied");
  });

  it("ignores events the app doesn't use, without touching Clerk", async () => {
    const { writes, store } = fakeOrgs();
    expect(await applyBillingEvent(store, fakeEvent("invoice.paid", {}))).toBe("ignored");
    expect(writes).toHaveLength(0);
  });
});

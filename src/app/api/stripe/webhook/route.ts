/**
 * Stripe webhook: keeps each Clerk Organization's billing metadata in sync.
 * Reads the raw body (never `.json()` first — signature verification needs
 * the exact bytes) and writes via `clerkClient`, since there's no user
 * session on a webhook request.
 *
 * No idempotency ledger: every patch here is "set the current known state"
 * (subscription status, current period end, ids), not an append — replaying
 * the same event twice just writes the same values again, which is harmless.
 */

import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { applyBillingEvent, mapStripeEventToOrgPatch } from "@/lib/stripeWebhook";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Server is missing STRIPE_WEBHOOK_SECRET" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const rawBody = await request.text();
  const stripe = getStripe();

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error("stripe-webhook: signature verification failed", error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Events this app doesn't use (invoices, charges…) are acknowledged without touching Clerk.
  if (!mapStripeEventToOrgPatch(event)) return NextResponse.json({ received: true });

  try {
    const clerk = await clerkClient();
    const outcome = await applyBillingEvent(clerk.organizations, event);
    if (outcome === "stale") {
      console.warn(`stripe-webhook: ignored ${event.type} ${event.id}, older than the status already applied`);
      return NextResponse.json({ received: true, ignored: "stale" });
    }
  } catch (error) {
    console.error("stripe-webhook: failed to update organization metadata", error);
    return NextResponse.json({ error: "Could not update organization" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

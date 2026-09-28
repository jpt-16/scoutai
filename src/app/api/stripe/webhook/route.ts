/**
 * Stripe webhook: keeps each `teams` row's subscription state in sync.
 * Reads the raw body (never `.json()` first — signature verification needs
 * the exact bytes) and writes with the service-role client, since there's no
 * user session on a webhook request.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { mapStripeEventToTeamPatch } from "@/lib/stripeWebhook";

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

  const admin = createAdminClient();

  // Idempotency: Stripe redelivers on non-2xx, and can send an event twice regardless.
  const { error: insertError } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type });
  if (insertError) {
    // Unique violation means we've already processed this event id.
    if (insertError.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error("stripe-webhook: failed to record event", insertError);
    return NextResponse.json({ error: "Could not record event" }, { status: 500 });
  }

  const teamPatch = mapStripeEventToTeamPatch(event);
  if (teamPatch) {
    const { matchOn } = teamPatch;
    const [matchColumn, matchValue] =
      "teamId" in matchOn
        ? (["id", matchOn.teamId] as const)
        : "stripeCustomerId" in matchOn
          ? (["stripe_customer_id", matchOn.stripeCustomerId] as const)
          : (["stripe_subscription_id", matchOn.stripeSubscriptionId] as const);

    const { error: updateError } = await admin
      .from("teams")
      .update(teamPatch.patch)
      .eq(matchColumn, matchValue);

    if (updateError) {
      console.error("stripe-webhook: failed to update team", updateError);
      return NextResponse.json({ error: "Could not update team" }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}

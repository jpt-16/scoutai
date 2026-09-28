/**
 * Starts a Stripe Checkout session for the caller's team, so it can become
 * entitled to the paid video-analysis feature. Entitlement isn't required to
 * call this route (that would be circular) — only sign-in and team membership.
 *
 * The price comes from a server-only env var rather than being hardcoded, so
 * pricing can change later in the Stripe dashboard with no code change (the
 * "decide pricing later, build the plumbing now" decision).
 */

import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request): Promise<NextResponse> {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return NextResponse.json({ error: "Server is missing STRIPE_PRICE_ID" }, { status: 500 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "sign_in_required", message: "Sign in first." }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id, teams (id, stripe_customer_id)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle<{ team_id: string; teams: { id: string; stripe_customer_id: string | null } | null }>();

  if (!membership?.teams) {
    return NextResponse.json(
      { error: "no_team", message: "Create or join a coaching staff team first." },
      { status: 403 },
    );
  }

  const origin = new URL(request.url).origin;
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer: membership.teams.stripe_customer_id ?? undefined,
    customer_email: membership.teams.stripe_customer_id ? undefined : user.email,
    client_reference_id: membership.teams.id,
    metadata: { team_id: membership.teams.id },
    subscription_data: { metadata: { team_id: membership.teams.id } },
    success_url: `${origin}/?checkout=success`,
    cancel_url: `${origin}/?checkout=canceled`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 502 });
  }

  return NextResponse.json({ url: session.url });
}

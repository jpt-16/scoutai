/**
 * Opens a Stripe Billing Portal session for the caller's team, so a coach can
 * manage payment method or cancel — entirely on Stripe's hosted UI.
 */

import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request): Promise<NextResponse> {
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

  const customerId = membership?.teams?.stripe_customer_id;
  if (!customerId) {
    return NextResponse.json(
      { error: "no_subscription", message: "Your team hasn't subscribed yet." },
      { status: 403 },
    );
  }

  const origin = new URL(request.url).origin;
  const stripe = getStripe();

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/`,
  });

  return NextResponse.json({ url: session.url });
}

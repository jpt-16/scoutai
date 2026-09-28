/**
 * Starts a Stripe Checkout session for the caller's active Clerk
 * organization, so it can become entitled to the paid video-analysis
 * feature. Entitlement isn't required to call this route (that would be
 * circular) — only sign-in and an active organization.
 *
 * The price comes from a server-only env var rather than being hardcoded, so
 * pricing can change later in the Stripe dashboard with no code change (the
 * "decide pricing later, build the plumbing now" decision).
 */

import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";

export async function POST(request: Request): Promise<NextResponse> {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return NextResponse.json({ error: "Server is missing STRIPE_PRICE_ID" }, { status: 500 });
  }

  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "sign_in_required", message: "Sign in first." }, { status: 401 });
  }
  if (!orgId) {
    return NextResponse.json(
      { error: "no_team", message: "Create or join a coaching staff team first." },
      { status: 403 },
    );
  }

  const clerk = await clerkClient();
  const org = await clerk.organizations.getOrganization({ organizationId: orgId });
  const existingCustomerId = (org.privateMetadata as { stripeCustomerId?: string }).stripeCustomerId;
  const user = existingCustomerId ? null : await currentUser();

  const origin = new URL(request.url).origin;
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer: existingCustomerId ?? undefined,
    customer_email: existingCustomerId ? undefined : user?.primaryEmailAddress?.emailAddress,
    client_reference_id: orgId,
    // org_id (a Clerk organization id) is what the webhook matches back to —
    // it's always present here, unlike stripe_customer_id, which isn't
    // written onto the org until this checkout actually completes.
    metadata: { org_id: orgId },
    subscription_data: { metadata: { org_id: orgId } },
    success_url: `${origin}/?checkout=success`,
    cancel_url: `${origin}/?checkout=canceled`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 502 });
  }

  return NextResponse.json({ url: session.url });
}

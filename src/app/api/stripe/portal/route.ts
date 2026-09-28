/**
 * Opens a Stripe Billing Portal session for the caller's active Clerk
 * organization, so a coach can manage payment method or cancel — entirely
 * on Stripe's hosted UI.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";

export async function POST(request: Request): Promise<NextResponse> {
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
  const customerId = (org.privateMetadata as { stripeCustomerId?: string }).stripeCustomerId;
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

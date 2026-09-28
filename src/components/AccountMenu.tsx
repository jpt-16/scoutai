"use client";

import { useState } from "react";
import { OrganizationSwitcher, SignInButton, UserButton, useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { isClerkConfigured } from "@/lib/clerkConfig";
import { useTeamAccount } from "@/lib/useTeamAccount";

/**
 * Header sign-in/out + organization control, only relevant to the paid
 * video feature. Hidden entirely when Clerk isn't configured — nothing to
 * sign into yet, and every hook here needs <ClerkProvider> (see layout.tsx).
 */
export function AccountMenu() {
  if (!isClerkConfigured()) return null;
  return <AccountMenuInner />;
}

function AccountMenuInner() {
  const { isLoaded, isSignedIn } = useUser();
  const account = useTeamAccount();
  const [busy, setBusy] = useState(false);

  async function handleManageBilling() {
    setBusy(true);
    try {
      const response = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await response.json();
      if (data.url) window.location.href = data.url;
    } finally {
      setBusy(false);
    }
  }

  if (!isLoaded) return null;

  if (!isSignedIn) {
    return (
      <SignInButton mode="modal">
        <Button variant="outline" size="sm">
          Sign in
        </Button>
      </SignInButton>
    );
  }

  return (
    <div className="flex items-center gap-2.5 text-sm">
      {/* Create/switch/manage-members are all Clerk's own built-in UI — no custom team dialogs needed. */}
      <OrganizationSwitcher hidePersonal afterCreateOrganizationUrl="/" afterSelectOrganizationUrl="/" />
      {account.team?.subscriptionStatus && (
        <Button variant="outline" size="sm" disabled={busy} onClick={handleManageBilling}>
          Manage billing
        </Button>
      )}
      <UserButton />
    </div>
  );
}

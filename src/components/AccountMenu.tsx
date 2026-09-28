"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthDialog } from "@/components/AuthDialog";
import { createClient } from "@/lib/supabase/client";
import { useTeamAccount } from "@/lib/useTeamAccount";

/** Header sign-in/out control, only relevant to the paid video feature. */
export function AccountMenu() {
  const { loading, user, team, configured, refresh } = useTeamAccount();
  const [authOpen, setAuthOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<"idle" | "copied" | "error">("idle");

  async function handleSignOut() {
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    setBusy(false);
    refresh();
  }

  async function handleInvite() {
    if (!team) return;
    setBusy(true);
    setInviteStatus("idle");
    try {
      const response = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.url) {
        setInviteStatus("error");
        return;
      }
      await navigator.clipboard.writeText(data.url);
      setInviteStatus("copied");
    } catch {
      setInviteStatus("error");
    } finally {
      setBusy(false);
    }
  }

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

  // Nothing to sign into yet — hide the control entirely rather than show a
  // "Sign in" button that would crash on submit (see src/lib/supabase/client.ts).
  if (!configured) return null;

  if (loading) return null;

  if (!user) {
    return (
      <>
        <Button variant="outline" size="sm" onClick={() => setAuthOpen(true)}>
          Sign in
        </Button>
        <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
      </>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground hidden sm:inline">{team?.name ?? user.email}</span>
      {team && (
        <Button variant="outline" size="sm" disabled={busy} onClick={handleInvite}>
          {inviteStatus === "copied" ? "Link copied" : inviteStatus === "error" ? "Owners only" : "Invite"}
        </Button>
      )}
      {team?.subscriptionStatus && (
        <Button variant="outline" size="sm" disabled={busy} onClick={handleManageBilling}>
          Manage billing
        </Button>
      )}
      <Button variant="ghost" size="sm" disabled={busy} onClick={handleSignOut}>
        Sign out
      </Button>
    </div>
  );
}

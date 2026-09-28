"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AuthDialog } from "@/components/AuthDialog";
import { BrandMark } from "@/components/BrandMark";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "signed-out" | "joining" | "joined" | "error">(
    "checking",
  );
  const [error, setError] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setStatus("error");
      setError("Sign-in isn't set up yet.");
      return;
    }

    let cancelled = false;
    const supabase = createClient();

    async function attempt() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;

      if (!user) {
        setStatus("signed-out");
        setAuthOpen(true);
        return;
      }

      setStatus("joining");
      const { error: rpcError } = await supabase.rpc("redeem_invite", { token });
      if (cancelled) return;

      if (rpcError) {
        setStatus("error");
        setError(rpcError.message);
        return;
      }
      setStatus("joined");
    }

    attempt();
    const { data: subscription } = supabase.auth.onAuthStateChange(() => attempt());
    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [token]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
      <BrandMark />

      {status === "checking" && <p className="text-muted-foreground text-sm">Checking invite…</p>}

      {status === "signed-out" && (
        <>
          <p className="text-sm">Sign in to join this coaching staff&apos;s team.</p>
          <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
        </>
      )}

      {status === "joining" && <p className="text-muted-foreground text-sm">Joining team…</p>}

      {status === "joined" && (
        <>
          <p className="text-sm">You&apos;re in. Welcome to the team.</p>
          <Button size="lg" onClick={() => router.push("/")}>
            Go to ScoutCard AI
          </Button>
        </>
      )}

      {status === "error" && (
        <p className="text-destructive text-sm">
          {error ?? "This invite is invalid or has expired."}
        </p>
      )}
    </main>
  );
}

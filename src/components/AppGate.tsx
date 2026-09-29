"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useClerk } from "@clerk/nextjs";
import { Lock, LogIn, LogOut } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { isClerkConfigured } from "@/lib/clerkConfig";
import { isAiGateDisabled } from "@/lib/featureFlags";
import { useTeamAccount } from "@/lib/useTeamAccount";
import { cn } from "@/lib/utils";

/**
 * Locks the app itself (uploads, the script reader, the playsheet, AI) behind
 * the same check the AI routes use: signed in, and either on the free
 * allow-list or on a subscribed staff (src/lib/entitlement.ts). Only where
 * Clerk is configured and the testing bypass is off, which is production:
 * preview deploys (NEXT_PUBLIC_SKIP_AI_GATE) and a plain local checkout stay
 * open. The landing page's own demos stay public.
 *
 * Offline on the practice field Clerk can't load, so an iPad that was
 * verified in the last `ACCESS_CACHE_DAYS` days opens straight in.
 *
 * This hides the app from people without access; the CSV reader itself runs
 * in the browser, so it's not a hard lock the way the paid AI routes are.
 */

const ACCESS_CACHE_KEY = "scoutcard:access:v1";
const ACCESS_CACHE_DAYS = 14;

function readAccessCache(): boolean {
  try {
    const raw = window.localStorage.getItem(ACCESS_CACHE_KEY);
    if (!raw) return false;
    const { at } = JSON.parse(raw) as { at?: number };
    return typeof at === "number" && Date.now() - at < ACCESS_CACHE_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function writeAccessCache(granted: boolean) {
  try {
    if (granted) window.localStorage.setItem(ACCESS_CACHE_KEY, JSON.stringify({ at: Date.now() }));
    else window.localStorage.removeItem(ACCESS_CACHE_KEY);
  } catch {
    // Private mode: no offline pass, everything else works.
  }
}

type Variant = "page" | "section";

export function AppGate({ children, variant = "page" }: { children: ReactNode; variant?: Variant }) {
  if (isAiGateDisabled() || !isClerkConfigured()) return <>{children}</>;
  return <AppGateInner variant={variant}>{children}</AppGateInner>;
}

function AppGateInner({ children, variant }: { children: ReactNode; variant: Variant }) {
  const account = useTeamAccount();
  // Read after mount: localStorage doesn't exist during server rendering.
  const [cached, setCached] = useState<boolean | null>(null);
  useEffect(() => setCached(readAccessCache()), []);

  const settled = !account.loading && !account.accessCheckFailed;
  useEffect(() => {
    if (settled) writeAccessCache(account.entitled);
  }, [settled, account.entitled]);

  if (settled)
    return account.entitled ? (
      <>{children}</>
    ) : (
      <Locked variant={variant} signedIn={Boolean(account.userId)} />
    );
  // Still checking, or offline: a recently verified iPad opens straight in.
  if (cached) return <>{children}</>;
  if (cached === null || account.loading) return <Checking variant={variant} />;
  return <Locked variant={variant} signedIn={Boolean(account.userId)} offline />;
}

function Frame({ variant, children }: { variant: Variant; children: ReactNode }) {
  return variant === "page" ? (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <BrandMark />
      {children}
    </main>
  ) : (
    <div className="flex flex-col items-center gap-5 rounded-2xl border-2 border-dashed border-input px-6 py-10 text-center">
      {children}
    </div>
  );
}

function Checking({ variant }: { variant: Variant }) {
  return (
    <Frame variant={variant}>
      <p className="text-lg text-muted-foreground">Checking your access…</p>
    </Frame>
  );
}

function Locked({ variant, signedIn, offline }: { variant: Variant; signedIn: boolean; offline?: boolean }) {
  const clerk = useClerk();
  return (
    <Frame variant={variant}>
      <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/25">
        <Lock className="size-6" aria-hidden="true" />
      </span>
      <div className="flex max-w-md flex-col gap-2">
        <h2 className={cn("font-display font-bold", variant === "page" ? "text-4xl" : "text-3xl")}>
          {offline
            ? "Connect to open ScoutCard AI"
            : signedIn
              ? "Your account doesn't have access yet"
              : "Sign in to use ScoutCard AI"}
        </h2>
        <p className="text-lg text-muted-foreground">
          {offline
            ? "Open it once online to verify your staff's access; after that it works on the field without a signal."
            : signedIn
              ? "ScoutCard AI is in a private pilot with coaching staffs. Ask your head coach or ScoutCard AI for an invite."
              : "ScoutCard AI is in a private pilot with coaching staffs. Sign in with the email your staff was invited with."}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {!offline && !signedIn && (
          <Button size="xl" onClick={() => clerk.openSignIn()}>
            <LogIn aria-hidden="true" />
            Sign in
          </Button>
        )}
        {!offline && signedIn && (
          <Button size="xl" variant="outline" onClick={() => void clerk.signOut()}>
            <LogOut aria-hidden="true" />
            Use a different account
          </Button>
        )}
        {variant === "page" && (
          <Button asChild size="xl" variant="outline">
            <Link href="/">Back to home</Link>
          </Button>
        )}
      </div>
    </Frame>
  );
}

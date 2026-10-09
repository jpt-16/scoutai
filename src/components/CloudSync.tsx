"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useAuth } from "@clerk/nextjs";
import { Cloud, CloudOff, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cloudSync, type SyncState } from "@/lib/cloudSync";
import { isClerkConfigured } from "@/lib/clerkConfig";
import { isAiGateDisabled } from "@/lib/featureFlags";
import type { SyncSlot } from "@/lib/syncMeta";
import { cn } from "@/lib/utils";

const SLOT_NAMES: Record<SyncSlot, string> = {
  script: "scout script",
  playbook: "playbook",
  practice: "practice playsheet",
};

const SERVER_STATE: SyncState = { status: "off", lastSyncedAt: null, conflicts: [], message: "" };

export function useSyncState(): SyncState {
  return useSyncExternalStore(cloudSync.subscribe, cloudSync.getState, () => SERVER_STATE);
}

/**
 * Mounted once in the root layout. While a coach is signed in it keeps this
 * device's script, playbook and playsheet in step with the staff's shared copy
 * (src/lib/cloudSync.ts), and asks which to keep when both changed. Does nothing
 * without Clerk, or on the open preview where there's no team to share with.
 */
export function CloudSync() {
  if (!isClerkConfigured() || isAiGateDisabled()) return null;
  return <CloudSyncInner />;
}

function CloudSyncInner() {
  const { isLoaded, isSignedIn, orgId, userId } = useAuth();
  const state = useSyncState();

  // Start when signed in. The shared copy is the team's, or the coach's own without a team
  // (the same key the server uses); a different one starts the device's sync history fresh.
  const owner = orgId ?? (userId ? `user-${userId}` : null);
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !owner) return;
    cloudSync.start(owner);
    return () => cloudSync.stop();
  }, [isLoaded, isSignedIn, owner]);

  const conflict = state.conflicts[0];
  return (
    <Dialog open={Boolean(conflict)}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        {conflict && (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl font-bold">
                Your staff has a different {SLOT_NAMES[conflict.slot]}
              </DialogTitle>
              <DialogDescription className="text-base">
                {conflict.updatedAt
                  ? `It was saved ${new Date(conflict.updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. `
                  : ""}
                This device has its own {SLOT_NAMES[conflict.slot]} too. Pick the one to keep; the other is replaced.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:flex-col">
              <Button size="lg" onClick={() => void cloudSync.resolve(conflict.slot, "staff")}>
                Use my staff&apos;s version
              </Button>
              <Button size="lg" variant="outline" onClick={() => void cloudSync.resolve(conflict.slot, "mine")}>
                Keep this device&apos;s and replace theirs
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A small chip for the reader's header: whether the staff's copy is up to date. */
export function SyncBadge({ className }: { className?: string }) {
  const state = useSyncState();
  if (state.status === "off") return null;
  const view = {
    idle: { icon: Cloud, text: "Synced", tone: "text-muted-foreground" },
    synced: { icon: Cloud, text: "Saved to your staff", tone: "text-muted-foreground" },
    syncing: { icon: Loader2, text: "Saving…", tone: "text-muted-foreground" },
    offline: { icon: CloudOff, text: "Offline · saves when back", tone: "text-amber-400" },
    conflict: { icon: TriangleAlert, text: "Choose a version", tone: "text-amber-400" },
    error: { icon: TriangleAlert, text: "Couldn't save yet", tone: "text-amber-400" },
  }[state.status];
  const Icon = view.icon;
  return (
    <span
      title={state.message || "Your script, playbook and playsheet are saved for everyone on your team."}
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold", view.tone, className)}
    >
      <Icon className={cn("size-3.5", state.status === "syncing" && "animate-spin")} aria-hidden="true" />
      {view.text}
    </span>
  );
}

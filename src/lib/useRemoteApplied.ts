"use client";

import { useEffect, useRef } from "react";
import { REMOTE_APPLIED_EVENT, type SyncSlot } from "./syncMeta";

/** Runs `onApplied` when the staff's copy of one of these slots was just loaded onto this device. */
export function useRemoteApplied(slots: SyncSlot[], onApplied: (slot: SyncSlot) => void): void {
  const latest = useRef(onApplied);
  latest.current = onApplied;
  const key = slots.join(",");
  useEffect(() => {
    const handler = (e: Event) => {
      const slot = (e as CustomEvent<{ slot: SyncSlot }>).detail?.slot;
      if (slot && key.split(",").includes(slot)) latest.current(slot);
    };
    window.addEventListener(REMOTE_APPLIED_EVENT, handler);
    return () => window.removeEventListener(REMOTE_APPLIED_EVENT, handler);
  }, [key]);
}

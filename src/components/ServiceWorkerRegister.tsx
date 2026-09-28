"use client";

import { useEffect } from "react";

/** Registers /sw.js in production so the app keeps working offline on the field. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support is a bonus; the app works without it.
    });
  }, []);
  return null;
}

"use client";

import { useEffect } from "react";
import { GAME_SAVE_DELAY_MS, markGameChanged, pendingGameSave, saveGameNow } from "@/lib/gameSave";
import { loadScript } from "@/lib/scriptStore";
import { CHANGED_EVENT } from "@/lib/syncMeta";

/**
 * On the script reader: every change to a script that came from a game in the film library is sent back to that game's own
 * copy (src/lib/gameSave.ts) a moment after the last one, again when the connection or the tab comes back, and as the tab is left.
 */
export function GameSaveBack() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const send = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (pendingGameSave()) void saveGameNow();
    };
    const later = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(send, GAME_SAVE_DELAY_MS);
    };
    const onChange = (event: Event) => {
      if ((event as CustomEvent<{ slot?: string }>).detail?.slot !== "script") return;
      const gameId = loadScript()?.gameId;
      if (!gameId) return;
      markGameChanged(gameId);
      later();
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") send();
    };
    // Changes left from an earlier visit (no signal then) go now.
    send();
    window.addEventListener(CHANGED_EVENT, onChange);
    window.addEventListener("online", send);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener(CHANGED_EVENT, onChange);
      window.removeEventListener("online", send);
      document.removeEventListener("visibilitychange", onHidden);
      // Leaving the reader (for the library, say): send what's waiting rather than drop the timer.
      send();
    };
  }, []);
  return null;
}

"use client";

import { useEffect, useState } from "react";
import { DeviceFrame } from "@/components/DeviceFrame";
import type { HudlPlayCard } from "@/lib/hudlParser";
import type { ScriptTendencies } from "@/lib/tendencies";
import { ScriptScreenMockup } from "./ScriptScreenMockup";

const ROTATE_MS = 3600;

/** The hero's iPad, cycling through a real parsed demo script. */
export function HeroDevice({ cards, tendencies }: { cards: HudlPlayCard[]; tendencies: ScriptTendencies }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      if (!document.hidden) setActive((i) => (i + 1) % cards.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [cards.length]);

  return (
    <div className="relative">
      <div
        className="absolute -inset-x-10 -inset-y-12 -z-10 rounded-full bg-[radial-gradient(closest-side,rgba(255,138,61,0.22),transparent)] blur-2xl"
        aria-hidden="true"
      />
      <div className="sc-float">
        <DeviceFrame>
          <ScriptScreenMockup
            cards={cards}
            active={active}
            tendencies={tendencies}
            fileName="scout-script.csv"
            label="ScoutCard AI's scout script on an iPad, flipping through practice-ready scout cards generated from a Hudl breakdown."
          />
        </DeviceFrame>
      </div>
    </div>
  );
}

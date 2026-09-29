import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A plain CSS iPad-style bezel around a scout card, for the landing page's
 * "see it on the iPad" showcase. No fake status bar or OS chrome — just a
 * frame, so it reads as a device without pretending to be a screenshot.
 */
export function DeviceFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-[32px] border border-[#3a4640] bg-gradient-to-b from-[#232e28] to-[#161e1a] p-3 shadow-2xl shadow-black/50",
        className,
      )}
    >
      <div className="rounded-[22px] bg-black/50 p-2">
        <div className="overflow-hidden rounded-[15px] bg-white">{children}</div>
      </div>
      <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[#3a4640]" aria-hidden="true" />
    </div>
  );
}

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A CSS landscape-iPad frame (aluminum edge, thin black bezel, front camera,
 * a faint glass sheen) around real app UI for the landing page. No fake OS
 * status bar — just hardware, so it reads as a device without pretending to
 * be a screenshot.
 */
export function DeviceFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative rounded-[28px] bg-gradient-to-b from-[#5b6660] via-[#3a4440] to-[#2a322e] p-[3px] shadow-[0_40px_80px_-24px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.04)] sm:rounded-[34px]",
        className,
      )}
    >
      <div className="relative rounded-[25px] bg-[#050706] p-[10px] sm:rounded-[31px] sm:p-[14px]">
        <span
          className="absolute top-[4px] left-1/2 size-[5px] -translate-x-1/2 rounded-full bg-[#1c2420] ring-1 ring-white/5 sm:top-[5px] sm:size-[6px]"
          aria-hidden="true"
        />
        <div className="relative overflow-hidden rounded-[14px] bg-background sm:rounded-[18px]">
          {children}
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.07] via-transparent to-transparent"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}

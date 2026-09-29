import { DeviceFrame } from "@/components/DeviceFrame";
import { ScoutCard } from "@/components/ScoutCard";
import type { HudlPlayCard } from "@/lib/hudlParser";
import { ScriptScreenMockup } from "./ScriptScreenMockup";

/** A Print Grid page (2-up, black on white) behind the iPad in Scout D. */
export function PracticeShowcase({ cards }: { cards: HudlPlayCard[] }) {
  return (
    <div className="relative mx-auto w-full max-w-[560px] pt-6 pb-10 sm:pt-10 sm:pb-16">
      <div
        role="img"
        aria-label="A printed Print Grid page with two black-and-white scout cards."
        className="absolute top-0 right-0 w-[52%] rotate-[5deg] rounded-md bg-white p-[3%] shadow-2xl shadow-black/60 sm:right-[-4%]"
      >
        <div className="pointer-events-none flex flex-col gap-[6%] select-none">
          <div className="flex items-end justify-between border-b-2 border-black pb-[3%] font-display text-[clamp(6px,1.6vw,11px)] font-extrabold text-black uppercase">
            <span>Scout offense · Team</span>
            <span className="font-sans font-semibold text-black/60 normal-case">Page 1 of 3</span>
          </div>
          {cards.slice(0, 2).map((card) => (
            <ScoutCard key={card.id} card={card} variant="print" />
          ))}
        </div>
      </div>

      <div className="relative w-[88%]">
        <DeviceFrame>
          <ScriptScreenMockup
            cards={cards}
            active={2}
            unit="defense"
            label="The scout script on an iPad in Scout Defense view: the offense's formation with the defense's alignment, flipped so the scout defense sees it from their side."
          />
        </DeviceFrame>
      </div>
    </div>
  );
}

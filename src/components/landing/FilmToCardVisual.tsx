"use client";

import { useState } from "react";
import { Hand, Pause, ScanEye } from "lucide-react";
import { ScoutCard } from "@/components/ScoutCard";
import { parseHudlCsvText, type HudlPlayCard } from "@/lib/hudlParser";

/**
 * The AI film section's centerpiece: a stylized game-film frame (an SVG
 * illustration, not footage) with route traces drawing themselves, flowing
 * into a real `ScoutCard` carrying `source: "video"` routes. The card is
 * live: its break-point handles drag exactly like they do in the app.
 */

// Deltas from each player's own spot (see RouteOverride.path), strength right.
const SAMPLE_AI_CARD: HudlPlayCard = {
  ...parseHudlCsvText("PLAY #,DN,DIST,HASH,OFF FORM,OFF PLAY\n12,3,6,M,TRIPS RT,AI DRAFT\n").cards[0],
  routeOverrides: {
    X: { source: "video", path: [[0, -52], [10, -104]] }, // fade
    H: { source: "video", path: [[0, -18], [-96, -26]] }, // shallow
    Y: { source: "video", path: [[0, -72], [-6, -112]] }, // seam
    Z: { source: "video", path: [[0, -84], [-12, -70]] }, // curl
  },
};

// Endzone-angle field illustration: yard lines converge toward the top.
const YARD_LINES = [0.1, 0.28, 0.46, 0.64, 0.82];
const OFFENSE: [number, number][] = [
  [150, 214], [168, 214], [186, 214], [204, 214], [222, 214], // line
  [186, 236], // Q
  [52, 206], [262, 210], [296, 208], [338, 206], // X H Y Z
];
const DEFENSE: [number, number][] = [
  [160, 196], [182, 194], [206, 196], [230, 198],
  [120, 176], [190, 170], [256, 174],
  [60, 150], [330, 146], [150, 110], [250, 108],
];
const TRACES: { d: string; len: number }[] = [
  { d: "M52 206 L54 156 L64 98", len: 115 },
  { d: "M262 210 L262 194 L176 186", len: 105 },
  { d: "M296 208 L296 134 L292 92", len: 120 },
  { d: "M338 206 L338 128 L326 142", len: 100 },
];

function FilmFrame() {
  return (
    <div
      role="img"
      aria-label="Illustration of a game-film frame with each receiver's route traced by the AI."
      className="overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/50"
    >
      <svg viewBox="0 0 390 270" className="block w-full">
        <defs>
          <linearGradient id="turf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2c4a33" />
            <stop offset="1" stopColor="#3f6a47" />
          </linearGradient>
          <linearGradient id="vignette" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#000" stopOpacity="0.45" />
            <stop offset="0.35" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        <rect width="390" height="270" fill="url(#turf)" />
        {YARD_LINES.map((t) => {
          const y = 40 + t * 210;
          const inset = 70 * (1 - t);
          return <line key={t} x1={inset} y1={y} x2={390 - inset} y2={y} stroke="#e8efe6" strokeOpacity="0.28" strokeWidth={1.4 + t} />;
        })}
        <line x1="70" y1="40" x2="0" y2="250" stroke="#e8efe6" strokeOpacity="0.35" strokeWidth="2" />
        <line x1="320" y1="40" x2="390" y2="250" stroke="#e8efe6" strokeOpacity="0.35" strokeWidth="2" />
        {DEFENSE.map(([x, y], i) => (
          <circle key={`d${i}`} cx={x} cy={y} r="5.5" fill="#1b2a44" stroke="#9fb4d8" strokeWidth="1.2" />
        ))}
        {OFFENSE.map(([x, y], i) => (
          <circle key={`o${i}`} cx={x} cy={y} r="6" fill="#f4f1e8" stroke="#0d1210" strokeWidth="1.2" />
        ))}
        {TRACES.map(({ d, len }) => (
          <path
            key={d}
            d={d}
            fill="none"
            stroke="#ff8a3d"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="sc-draw"
            style={{ ["--sc-len" as string]: len }}
          />
        ))}
        {TRACES.map(({ d }) => {
          const pts = d.replace(/M|L/g, " ").trim().split(/\s+/).map(Number);
          return (
            <circle key={`b${d}`} cx={pts[2]} cy={pts[3]} r="4.5" fill="#0d1210" stroke="#ff8a3d" strokeWidth="2" />
          );
        })}
        <rect width="390" height="270" fill="url(#vignette)" />
      </svg>
      <div className="flex items-center gap-3 bg-[#0b0d0c] px-3 py-2.5 text-[11px] font-semibold text-white/70">
        <Pause className="size-3.5 fill-current" aria-hidden="true" />
        <div className="relative h-1 flex-1 rounded-full bg-white/15">
          <div className="absolute inset-y-0 left-0 w-[58%] rounded-full bg-primary" />
        </div>
        <span className="tabular-nums">0:08 / 0:14</span>
      </div>
    </div>
  );
}

export function FilmToCardVisual() {
  const [card, setCard] = useState(SAMPLE_AI_CARD);

  return (
    <div className="grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.15fr)] lg:gap-6">
      <div className="flex min-w-0 flex-col gap-3">
        <span className="w-fit rounded-full border px-3 py-1 text-xs font-bold tracking-[0.12em] text-muted-foreground">
          1 · YOUR CLIP
        </span>
        <FilmFrame />
      </div>

      <div className="flex flex-row items-center justify-center gap-3 lg:flex-col" aria-hidden="true">
        <div className="relative h-px w-10 bg-gradient-to-r from-transparent via-primary/70 to-transparent lg:hidden" />
        <span className="flex size-12 items-center justify-center rounded-full border-2 border-primary bg-primary/10 text-primary">
          <ScanEye className="size-6" />
        </span>
        <span className="text-xs font-bold tracking-[0.12em] text-primary">AI READS ROUTES</span>
        <div className="relative h-px w-10 bg-gradient-to-r from-transparent via-primary/70 to-transparent lg:hidden" />
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="w-fit rounded-full border px-3 py-1 text-xs font-bold tracking-[0.12em] text-muted-foreground">
            2 · YOUR CARD
          </span>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
            <Hand className="size-3.5" aria-hidden="true" />
            Try it: drag a break point
          </span>
        </div>
        <div className="rounded-[18px] shadow-2xl shadow-black/50">
          <ScoutCard
            card={card}
            onEditDetectedRoute={(letter, path) =>
              setCard((c) => ({
                ...c,
                routeOverrides: { ...c.routeOverrides, [letter]: { ...c.routeOverrides?.[letter], path } },
              }))
            }
          />
        </div>
      </div>
    </div>
  );
}

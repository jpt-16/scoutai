import { ChevronDown, FileSpreadsheet, Info, MousePointer2 } from "lucide-react";

/**
 * "How do I get my breakdown out of Hudl?" — the four real steps, next to a
 * zoomed-in recreation of the one menu that matters (the data grid's ⋯ menu
 * → Export Data to Excel). Recreated in HTML rather than a screenshot: it
 * stays crisp at any size and keeps real game footage (and the players in
 * it) and real school names off the marketing page. Rows use the app's own
 * demo data. Hudl's layout and wording vary by version, and the note says so.
 */

const STEPS: { title: string; detail: string }[] = [
  { title: "Open the opponent's film", detail: "Log in to Hudl and open the game your staff broke down." },
  { title: "Find the data grid", detail: "It's under the video — the rows with PLAY #, DN, DIST, and your tags." },
  { title: "Click the ⋯ menu", detail: "At the right end of the grid's toolbar." },
  { title: "Export Data to Excel", detail: "Drop that file here. .xlsx works as-is — no converting to CSV." },
];

const GRID_HEAD = ["PLAY #", "DN", "DIST", "HASH", "OFF FORM", "OFF PLAY"];
const GRID_ROWS = [
  ["1", "1", "10", "L", "Spread", "Inside Zone"],
  ["2", "2", "4", "L", "Trips Right", "Quick Slant"],
  ["3", "1", "10", "M", "I-Form", "Power Right"],
];

function HudlMenuMockup() {
  return (
    <figure className="@container flex flex-col gap-2.5">
      <div
        role="img"
        aria-label="Hudl's clip data grid, with the ⋯ menu at the right end of its toolbar opened to Export Data to Excel."
        className="relative min-h-[214px] overflow-hidden rounded-2xl border border-white/10 bg-[#1e2023] font-sans text-[13px] text-[#d7dadf] shadow-2xl shadow-black/40"
      >
        {/* Grid toolbar */}
        <div className="flex items-stretch justify-between border-b border-white/10 bg-[#2a2c30]">
          <div className="hidden items-center gap-4 px-4 text-[#aeb3ba] @[520px]:flex">
            <span>Clips 1–100</span>
            <span className="flex items-center gap-1">
              Columns <ChevronDown className="size-3.5" aria-hidden="true" />
            </span>
          </div>
          <div className="ml-auto flex items-stretch text-[#e6e8eb]">
            <span className="hidden items-center border-l border-white/10 px-3 py-3 @[420px]:flex">Add Slide</span>
            <span className="flex items-center border-l border-white/10 px-3 py-3">Save Playlist</span>
            <span className="flex items-center border-l border-white/10 px-3 py-3">Edit Data</span>
            <span className="relative flex items-center border-l border-white/10 bg-primary/15 px-4 text-xl leading-none font-bold text-primary">
              <span className="absolute inset-1.5 rounded-md ring-2 ring-primary" aria-hidden="true" />⋯
            </span>
          </div>
        </div>

        {/* Grid rows */}
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-white/10 text-[11px] font-bold tracking-wide text-[#aeb3ba]">
              {GRID_HEAD.map((h, i) => (
                <th key={h} className={`px-3 py-2 ${i > 3 ? "hidden @[460px]:table-cell" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GRID_ROWS.map((row) => (
              <tr key={row[0]} className="border-b border-white/5 last:border-0">
                {row.map((cell, i) => (
                  <td key={i} className={`px-3 py-2 text-[#c9cdd2] ${i > 3 ? "hidden @[460px]:table-cell" : ""}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {/* The opened ⋯ menu */}
        <div className="absolute top-[50px] right-2 w-[196px] overflow-hidden rounded-lg border border-white/10 bg-[#141517] py-1 shadow-2xl shadow-black/60">
          <div className="relative flex items-center gap-2 bg-primary px-3 py-2 font-semibold text-primary-foreground">
            <FileSpreadsheet className="size-4" aria-hidden="true" />
            Export Data to Excel
            <MousePointer2
              className="absolute -bottom-3 right-4 size-5 fill-white text-black drop-shadow"
              aria-hidden="true"
            />
          </div>
          <div className="px-3 py-2 text-[#c9cdd2]">Import Data</div>
          <div className="px-3 py-2 text-[#c9cdd2]">Delete Clip</div>
        </div>
      </div>
      <figcaption className="text-xs text-muted-foreground">
        Illustration of Hudl&apos;s clip grid. Menu names can vary a little by Hudl version.
      </figcaption>
    </figure>
  );
}

export function HudlExportGuide() {
  return (
    <div className="flex flex-col gap-6 rounded-3xl border bg-card/60 p-6 sm:p-8">
      <div className="flex flex-col gap-1.5">
        <p className="text-[13px] font-bold tracking-[0.2em] text-primary">GET YOUR FILE FROM HUDL</p>
        <h3 className="font-display text-3xl leading-none font-extrabold uppercase">Four clicks in Hudl</h3>
      </div>

      <HudlMenuMockup />

      <ol className="flex flex-col gap-4">
        {STEPS.map(({ title, detail }, i) => (
          <li key={title} className="flex gap-3.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-display text-base font-extrabold text-primary-foreground">
              {i + 1}
            </span>
            <div className="flex flex-col gap-0.5 pt-0.5">
              <span className="text-[15px] font-bold">{title}</span>
              <span className="text-sm leading-relaxed text-muted-foreground">{detail}</span>
            </div>
          </li>
        ))}
      </ol>

      <p className="flex gap-2.5 rounded-xl border border-dashed p-3.5 text-sm leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <span>
          The video needs breakdown data tagged on it, and your Hudl account needs coach or admin access to
          export. Already in a spreadsheet? Copy the rows and use <strong className="text-foreground">Paste breakdown</strong>.
        </span>
      </p>
    </div>
  );
}

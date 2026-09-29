/**
 * A stylized "before" mockup of a Hudl breakdown export for the landing
 * page's before/after visual. Uses the app's own demo play data
 * (src/lib/demoScript.ts) so it's an honest representation of a real Hudl
 * export shape, not invented data.
 */

const HEADERS = ["PLAY #", "DN", "DIST", "YARD LN", "HASH", "OFF FORM", "OFF PLAY", "DEF FRONT"];

const ROWS = [
  ["1", "1", "10", "Opp 45", "L", "Spread", "Inside Zone", "4-3"],
  ["2", "2", "4", "Opp 39", "L", "Trips Right", "Quick Slant", "3-4"],
  ["3", "1", "10", "Opp 27", "M", "I-Form", "Power Right", "5-2"],
  ["4", "2", "6", "Opp 23", "R", "Double Eagle", "Jet Sweep", "4-3"],
  ["5", "1", "10", "Opp 8", "R", "Pro Set", "PA TE Leak", "Cover 3"],
];

export function HudlCsvMockup() {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-xl shadow-black/30">
      <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-[#28c840]" aria-hidden="true" />
        <span className="ml-2 text-xs font-semibold text-muted-foreground">hudl-breakdown-wk7.csv</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[540px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b bg-muted/30 text-muted-foreground">
              {HEADERS.map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 font-bold tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, i) => (
              <tr key={i} className="border-b last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className="whitespace-nowrap px-3 py-2 text-foreground/80">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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

// Columns dropped in `compact` mode: YARD LN and DEF FRONT.
const COMPACT_HIDDEN = new Set([3, 7]);

/**
 * `highlightRow` (0-based) marks the row the landing page shows becoming a
 * card. `compact` drops two columns so the ones that shape the card fit.
 */
export function HudlCsvMockup({ highlightRow, compact }: { highlightRow?: number; compact?: boolean }) {
  const keep = (j: number) => !compact || !COMPACT_HIDDEN.has(j);
  const pad = compact ? "px-2 sm:px-3" : "px-3";
  // Compact lets headers and the formation / play-call cells wrap on narrow screens.
  const wrapTh = compact ? "sm:whitespace-nowrap" : "whitespace-nowrap";
  const wrapTd = (j: number) => (compact && j >= 5 ? "sm:whitespace-nowrap" : "whitespace-nowrap");
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-xl shadow-black/30">
      <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-[#28c840]" aria-hidden="true" />
        <span className="ml-2 text-xs font-semibold text-muted-foreground">hudl-breakdown-wk7.csv</span>
      </div>
      <div className="overflow-x-auto">
        <table className={`w-full border-collapse text-left text-xs ${compact ? "" : "min-w-[540px]"}`}>
          <thead>
            <tr className="border-b bg-muted/30 text-muted-foreground">
              {HEADERS.map((h, j) =>
                keep(j) ? (
                  <th key={h} className={`${wrapTh} ${pad} py-2 align-bottom font-bold tracking-wide`}>
                    {h}
                  </th>
                ) : null,
              )}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, i) => {
              const hot = i === highlightRow;
              return (
                <tr key={i} className={hot ? "sc-row-pulse border-b last:border-0" : "border-b last:border-0"}>
                  {row.map((cell, j) => keep(j) && (
                    <td
                      key={j}
                      className={
                        hot
                          ? `${wrapTd(j)} ${pad} py-2.5 font-semibold text-foreground ${j === 0 ? "shadow-[inset_3px_0_0] shadow-primary" : ""}`
                          : `${wrapTd(j)} ${pad} py-2.5 text-foreground/70`
                      }
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

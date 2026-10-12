/**
 * How many routes the film analyzer got right, against the coach's calls.
 *
 *   npx jiti scripts/score-routes.ts tracks/ --key corrected.csv
 *
 * `tracks/` is what `python -m eval.tracks` wrote (one `<clip>.json` per play). `corrected.csv` is the
 * breakdown with the right calls (the app's Review → Scorecard → Corrected download, or Hudl's export
 * once a coach has fixed it): each clip is lined up with its row by the number in the file name, like the
 * game import (`planBatch`), and the row's call is drawn into a route per receiver as the key
 * (`routeScore.keyRoutes`). Prints every play, then the totals: routes right overall, how many the analyzer
 * committed to and how many of those were right, blocks, and the most common mistakes.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { planBatch } from "../src/lib/batchMatcher";
import { parseHudlCsvText } from "../src/lib/hudlParser";
import { keyRoutes, report, scorePlay, summarize, type RouteVerdict } from "../src/lib/routeScore";
import { cardFromTracks, type TrackedPlayFile } from "../src/lib/trackedPlay";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const keyPath = flag("--key");
if (!dir || !keyPath) {
  console.error("usage: npx jiti scripts/score-routes.ts tracks/ --key corrected.csv");
  process.exit(2);
}

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const sheet = parseHudlCsvText(readFileSync(keyPath, "utf8"));
const plan = planBatch(files.map((f) => f.replace(/\.json$/, ".mp4")), sheet.cards);

const all: RouteVerdict[] = [];
let unkeyed = 0;
for (const row of plan.rows) {
  if (!row.clip) continue;
  const file = JSON.parse(readFileSync(join(dir, row.clip.replace(/\.mp4$/, ".json")), "utf8")) as TrackedPlayFile;
  const key = keyRoutes(row.card);
  unkeyed += [...key.values()].filter((k) => k === null).length;
  const { reads } = cardFromTracks(file, row.card);
  const verdicts = scorePlay(key, reads);
  all.push(...verdicts);
  const cells = verdicts.map((v) => {
    const got = v.read ? `${v.read.kind}${v.read.kind === "block" || v.read.kind === "unknown" ? "" : ` ${v.read.confidence.toFixed(2)}`}` : "not tracked";
    return `${v.letter} ${v.key}${v.right ? " ✓" : ` ✗ (${got})`}`;
  });
  console.log(`Play ${row.card.playNumber} (${row.clip}) ${row.card.formation} · ${row.card.playCall}: ${cells.join(" | ")}`);
}
for (const clip of plan.unmatchedClips) console.log(`${clip}: no row in the key for this play`);
console.log("");
for (const line of report(summarize(all))) console.log(line);
if (unkeyed) console.log(`Not scored: ${unkeyed} receivers whose route on the call has no route-tree name (a mesh drag, a rail)`);

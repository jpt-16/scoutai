/**
 * Routes per letter against what the coach says each man ran (his own read of the film), not against the call's template:
 *
 *   npx jiti scripts/score-truth.ts tracks/ --sheet hudl.csv --truth truth.json
 *
 * `truth.json`: { "8": { "Z": "corner", "Y": "shallow", "X": "hitch|curl" }, ... } keyed by play number, then card letter;
 * `a|b` accepts either name. A letter the coach didn't name isn't scored. Prints, per play, each scored letter's read, its
 * confidence and runner-up, then the totals (right, and right counting the runner-up).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { planBatch } from "../src/lib/batchMatcher";
import { parseHudlCsvText } from "../src/lib/hudlParser";
import { cardFromTracks, type TrackedPlayFile } from "../src/lib/trackedPlay";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const sheetPath = flag("--sheet");
const truthPath = flag("--truth");
if (!dir || !sheetPath || !truthPath) {
  console.error("usage: npx jiti scripts/score-truth.ts tracks/ --sheet hudl.csv --truth truth.json");
  process.exit(2);
}
const truth = JSON.parse(readFileSync(truthPath, "utf8")) as Record<string, Record<string, string>>;
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const plays = new Map(files.map((f) => [f, JSON.parse(readFileSync(join(dir, f), "utf8")) as TrackedPlayFile]));
const parsed = parseHudlCsvText(readFileSync(sheetPath, "utf8"));
const plan = planBatch(files.map((f) => f.replace(/\.json$/, ".mp4")), parsed.cards);
const norm = (k: string) => k.replace(/-/g, " ").toLowerCase();
let scored = 0;
let right = 0;
let rightWithRunnerUp = 0;
for (const row of plan.rows) {
  const file = row.clip ? plays.get(row.clip.replace(/\.mp4$/, ".json")) : undefined;
  if (!file) continue;
  const want = truth[String(row.card.playNumber)] ?? {};
  const { card, reads } = cardFromTracks(file, row.card, { source: "truth" });
  const parts: string[] = [];
  for (const [letter, names] of Object.entries(want)) {
    const accepted = names.split("|").map(norm);
    const read = reads.find((r) => r.letter === letter);
    scored++;
    if (!read) {
      parts.push(`${letter}: ${names} -> no track`);
      continue;
    }
    const ok = accepted.includes(norm(read.kind));
    const ok2 = ok || (read.runnerUp !== undefined && accepted.includes(norm(read.runnerUp)));
    if (ok) right++;
    if (ok2) rightWithRunnerUp++;
    parts.push(`${letter}: ${names} -> ${norm(read.kind)} ${read.confidence.toFixed(2)}${read.runnerUp ? ` (then ${norm(read.runnerUp)})` : ""} ${ok ? "✓" : ok2 ? "~" : "✗"}`);
  }
  console.log(`Play ${row.card.playNumber} ${card.formation}: ${parts.join(" | ") || "(no truth given)"}`);
}
console.log(`\nRoutes right: ${right} of ${scored}  ·  right or the runner-up: ${rightWithRunnerUp} of ${scored}`);

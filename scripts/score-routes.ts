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
import { readDefense } from "../src/lib/defenseRead";
import { coverageFamilyOf, readCoverage } from "../src/lib/coverageRead";
import { playKind, runScheme } from "../src/lib/formations";
import { readRun } from "../src/lib/runRead";
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
// Scout D: the front the film read against the front the key tagged (where it tagged one).
// Run or pass, and on a run the scheme and the direction, against the key's call.
const tally = { kind: [0, 0], scheme: [0, 0], direction: [0, 0] };
const runMisses: string[] = [];
let frontsKeyed = 0;
// Scout D: the coverage the film read after the snap against the key's COVERAGE (by family: Cover 3 Sky = C3).
const cover = { keyed: 0, right: 0, sure: 0, sureRight: 0, misses: [] as string[] };
let frontsRight = 0;
const frontMisses: string[] = [];
for (const row of plan.rows) {
  if (!row.clip) continue;
  const file = JSON.parse(readFileSync(join(dir, row.clip.replace(/\.mp4$/, ".json")), "utf8")) as TrackedPlayFile;
  const key = keyRoutes(row.card);
  unkeyed += [...key.values()].filter((k) => k === null).length;
  const { reads: routeReads } = cardFromTracks(file, row.card);
  // When the film reads the play as a run, the receivers are blocking (as the card draws them), whatever their paths look like.
  const runRead = readRun(file);
  const reads = runRead.kind === "run" ? routeReads.map((r) => ({ ...r, kind: "block" as const, confidence: 1 })) : routeReads;
  const verdicts = scorePlay(key, reads);
  all.push(...verdicts);
  const cells = verdicts.map((v) => {
    const got = v.read ? `${v.read.kind}${v.read.kind === "block" || v.read.kind === "unknown" ? "" : ` ${v.read.confidence.toFixed(2)}`}` : "not tracked";
    return `${v.letter} ${v.key}${v.right ? " ✓" : ` ✗ (${got})`}`;
  });
  let run = "";
  const keyKind = playKind(row.card);
  if (keyKind === "run" || keyKind === "pass" || keyKind === "pa") {
    const read = runRead;
    const want = keyKind === "run" ? "run" : "pass";
    tally.kind[1]++;
    if (read.kind === want) tally.kind[0]++;
    const parts = [`${want}${read.kind === want ? " ✓" : ` ✗ (${read.kind})`}`];
    if (want === "run") {
      const scheme = runScheme(row.card);
      tally.scheme[1]++;
      if (read.scheme === scheme) tally.scheme[0]++;
      else runMisses.push(`${scheme} → ${read.scheme ?? read.kind}`);
      parts.push(`${scheme}${read.scheme === scheme ? " ✓" : ` ✗ (${read.scheme ?? "-"})`}`);
      if (/^[LR]/i.test(row.card.playDir.trim())) {
        tally.direction[1]++;
        const right = read.direction === row.card.playDirection;
        if (right) tally.direction[0]++;
        parts.push(`${row.card.playDirection}${right ? " ✓" : ` ✗ (${read.direction ?? "-"})`}`);
      }
    }
    run = ` || ${parts.join(" ")}`;
  }
  const defense = readDefense(file);
  let front = "";
  if (row.card.frontKey !== "unknown") {
    frontsKeyed++;
    const right = !!defense?.plausible && defense.frontKey === row.card.frontKey;
    if (right) frontsRight++;
    else frontMisses.push(`${row.card.defFront} → ${defense ? defense.label : "not read"}`);
    front = ` || front ${row.card.defFront}${right ? " ✓" : ` ✗ (${defense ? defense.label : "not read"})`}`;
  }
  const keyCover = coverageFamilyOf(row.card.coverage);
  let coverage = "";
  if (keyCover) {
    const read = readCoverage(file);
    const right = read?.family === keyCover;
    cover.keyed++;
    if (right) cover.right++;
    if (read?.sure) {
      cover.sure++;
      if (right) cover.sureRight++;
    }
    if (!right) cover.misses.push(`${row.card.coverage} → ${read ? read.label : "not read"}`);
    coverage = ` || coverage ${row.card.coverage}${right ? " ✓" : ` ✗ (${read ? `${read.label}${read.sure ? "" : ", unsure"}` : "not read"})`}`;
  }
  console.log(`Play ${row.card.playNumber} (${row.clip}) ${row.card.formation} · ${row.card.playCall}: ${cells.join(" | ")}${run}${front}${coverage}`);
}
for (const clip of plan.unmatchedClips) console.log(`${clip}: no row in the key for this play`);
console.log("");
for (const line of report(summarize(all))) console.log(line);
const share = ([r, n]: number[]) => `${r} of ${n} (${n ? Math.round((100 * r) / n) : 0}%)`;
if (tally.kind[1]) {
  console.log(`Run or pass right: ${share(tally.kind)}`);
  if (tally.scheme[1]) console.log(`Run schemes right: ${share(tally.scheme)}${tally.direction[1] ? `  ·  direction right: ${share(tally.direction)}` : ""}`);
  if (runMisses.length) console.log(`  missed: ${runMisses.slice(0, 8).join(", ")}`);
}
if (frontsKeyed) {
  console.log(`Fronts right (Scout D): ${frontsRight} of ${frontsKeyed} (${Math.round((100 * frontsRight) / frontsKeyed)}%)`);
  if (frontMisses.length) console.log(`  missed: ${frontMisses.slice(0, 8).join(", ")}`);
}
if (cover.keyed) {
  console.log(`Coverages right (Scout D): ${share([cover.right, cover.keyed])}  ·  sure reads right: ${share([cover.sureRight, cover.sure])}`);
  if (cover.misses.length) console.log(`  missed: ${cover.misses.slice(0, 8).join(", ")}`);
}
if (unkeyed) console.log(`Not scored: ${unkeyed} receivers whose route on the call has no route-tree name (a mesh drag, a rail)`);

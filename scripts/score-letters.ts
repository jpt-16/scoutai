/**
 * Which letter the card gives each man, against who he is: for the hand-marked plays (`video-service/eval/truth/**\/play_NN_men.json`:
 * each man's letter and where he stood at his first mark), the card's letter at that spot (`offenseSpots`, the nearest within
 * `NEAR_YARDS`) is right when it is his own. Run on tracks written without taps and with them to see what a tap buys:
 *
 *   npx jiti scripts/score-letters.ts tracks/ --sheet hudl.csv --marks eval/truth/cm_andover
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { planBatch } from "../src/lib/batchMatcher";
import { parseHudlCsvText } from "../src/lib/hudlParser";
import { cardFromTracks, type TrackedPlayFile } from "../src/lib/trackedPlay";

const NEAR_YARDS = 3;
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const sheetPath = flag("--sheet");
const marksDir = flag("--marks");
if (!dir || !sheetPath || !marksDir) {
  console.error("usage: npx jiti scripts/score-letters.ts tracks/ --sheet hudl.csv --marks <dir with play_NN_men.json>");
  process.exit(2);
}
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const plays = new Map(files.map((f) => [f, JSON.parse(readFileSync(join(dir, f), "utf8")) as TrackedPlayFile]));
const parsed = parseHudlCsvText(readFileSync(sheetPath, "utf8"));
const plan = planBatch(files.map((f) => f.replace(/\.json$/, ".mp4")), parsed.cards);
let right = 0;
let total = 0;
for (const row of plan.rows) {
  const file = row.clip ? plays.get(row.clip.replace(/\.mp4$/, ".json")) : undefined;
  if (!file) continue;
  const n = String(row.card.playNumber).padStart(2, "0");
  let marks: { men: Record<string, Record<string, [number, number]>> };
  try {
    marks = JSON.parse(readFileSync(join(marksDir, `play_${n}_men.json`), "utf8"));
  } catch {
    continue;
  }
  const { card } = cardFromTracks(file, row.card, { source: "letters" });
  const spots = Object.entries(card.offenseSpots ?? {});
  const parts: string[] = [];
  for (const [name, byFrame] of Object.entries(marks.men)) {
    const first = Object.entries(byFrame).sort((a, b) => Number(a[0]) - Number(b[0]))[0][1];
    const best = spots
      .map(([letter, s]) => ({ letter, d: Math.hypot(s.x - first[0], s.y - first[1]) }))
      .sort((a, b) => a.d - b.d)[0];
    total++;
    const ok = !!best && best.d <= NEAR_YARDS && best.letter === name;
    if (ok) right++;
    parts.push(`${name}${ok ? "✓" : best && best.d <= NEAR_YARDS ? `✗(${best.letter})` : "✗(none)"}`);
  }
  console.log(`Play ${row.card.playNumber}: ${parts.join(" ")}`);
}
console.log(`\nLetters right: ${right} of ${total}`);

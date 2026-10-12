/**
 * A game's tracked plays → one scout script the app opens.
 *
 *   npx jiti scripts/tracks-to-cards.ts tracks/ [--sheet hudl.csv] [--formations ours.csv] [--out game.json]
 *
 * `tracks/` is what `python -m eval.tracks` wrote: one `<clip>.json` per play. With `--sheet`
 * (Hudl's breakdown, CSV) each play's file is lined up with its row the same way the app's
 * one-click game import lines up clips (`planBatch`: the number in the file name, against PLAY #
 * or row order), and the sheet stays ground truth for down, distance, formation and call; only
 * the routes and where each man stood come from the film. Without a sheet every play is its own
 * card, its formation taken from `--formations` (what `eval.presnap` wrote, by play number).
 *
 * Writes `game.json`, a script the app opens (landing page → Open a tracked game), and prints
 * the plays whose routes the reader wasn't sure of, which are also marked on the cards.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { planBatch } from "../src/lib/batchMatcher";
import { parseHudlCsvText } from "../src/lib/hudlParser";
import { applyDefenseRead, frontsByFormation, readDefense, secondaryFromFilm, type DefenseRead } from "../src/lib/defenseRead";
import type { HudlPlayCard } from "../src/lib/hudlParser";
import { cardFromTracks, type TrackedPlayFile } from "../src/lib/trackedPlay";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!dir) {
  console.error("usage: npx jiti scripts/tracks-to-cards.ts tracks/ [--sheet hudl.csv] [--formations ours.csv] [--out game.json]");
  process.exit(2);
}
const out = flag("--out") ?? "game.json";

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const plays = new Map(files.map((f) => [f, JSON.parse(readFileSync(join(dir, f), "utf8")) as TrackedPlayFile]));

// What the pre-snap reader wrote (`eval.presnap`'s ours.csv: PLAY #, OFF FORM, OFF STR), by play number.
const formations = new Map<number, string>();
const formationsPath = flag("--formations");
if (formationsPath) {
  const [header, ...lines] = readFileSync(formationsPath, "utf8").split(/\r?\n/).filter(Boolean);
  const cols = header.split(",");
  const [num, form, str] = ["PLAY #", "OFF FORM", "OFF STR"].map((c) => cols.indexOf(c));
  for (const line of lines) {
    const cells = line.split(",");
    const n = Number.parseInt(cells[num] ?? "", 10);
    if (Number.isFinite(n) && cells[form]) formations.set(n, `${cells[form]} ${str >= 0 ? cells[str] ?? "" : ""}`.trim());
  }
}
const playNumberOf = (stem: string, fallback: number) => {
  const m = stem.match(/\d+/);
  return m ? Number.parseInt(m[0], 10) : fallback;
};

const sheetPath = flag("--sheet");
const cards = [];
const checks: string[] = [];
const warnings: string[] = [];
// Scout D: each play's defense at the snap, kept to roll up by formation.
const defenses: { card: HudlPlayCard; read: DefenseRead }[] = [];
const withDefense = (card: HudlPlayCard, file: TrackedPlayFile): HudlPlayCard => {
  const read = readDefense(file);
  if (!read) return card;
  const next = applyDefenseRead(card, read);
  defenses.push({ card: next, read });
  return next;
};

if (sheetPath) {
  const parsed = parseHudlCsvText(readFileSync(sheetPath, "utf8"));
  const plan = planBatch(files.map((f) => f.replace(/\.json$/, ".mp4")), parsed.cards);
  warnings.push(...parsed.warnings);
  for (const row of plan.rows) {
    const file = row.clip ? plays.get(row.clip.replace(/\.mp4$/, ".json")) : undefined;
    if (!file) {
      cards.push(row.card); // no film for this row: the sheet draws it, as always
      continue;
    }
    const { card, unsure } = cardFromTracks(file, row.card, { source: basename(sheetPath) });
    cards.push(withDefense(card, file));
    if (unsure.length) checks.push(`Play ${card.playNumber}: ${unsure.map((u) => u.letter).join(", ")}`);
  }
  for (const clip of plan.unmatchedClips) warnings.push(`${clip}: no row in the sheet for this play`);
} else {
  files.forEach((f, i) => {
    const stem = f.replace(/\.json$/, "");
    const { card, unsure } = cardFromTracks(plays.get(f)!, null, {
      formation: formations.get(playNumberOf(stem, i + 1)) ?? "",
      source: stem,
      playNumber: playNumberOf(stem, i + 1),
    });
    cards.push(withDefense(card, plays.get(f)!));
    if (unsure.length) checks.push(`Play ${i + 1} (${stem}): ${unsure.map((u) => u.letter).join(", ")}`);
  });
}

const title = sheetPath ? basename(sheetPath) : basename(dir);
// How the defense lined its corners and safeties up against each formation: the Secondary table, from film.
const dbAlignments = secondaryFromFilm(defenses.map(({ card, read }) => ({ formationKey: card.formationKey, read })));
const script = { fileName: title, films: [title], savedAt: new Date().toISOString(), cards, warnings, dbAlignments };
writeFileSync(out, JSON.stringify(script));
console.log(`${cards.length} cards → ${out}`);
if (checks.length) console.log(`Routes to check:\n  ${checks.join("\n  ")}`);
if (defenses.length) {
  console.log(`Defense read on ${defenses.filter((d) => d.read.plausible).length} of ${cards.length} plays (the rest marked "Check D"). By formation:`);
  for (const line of frontsByFormation(defenses.map(({ card, read }) => ({ formation: card.formation, read })))) console.log(`  ${line}`);
}

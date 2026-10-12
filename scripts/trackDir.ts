/**
 * Loads a folder of tracks files for `tracks-to-cards.ts` and `score-routes.ts`. A play filmed from two places has two files,
 * `play_007.json` and `play_007_b.json` (see `src/lib/viewMerge.ts`): they are merged into one play under the first view's
 * name, so everything downstream sees one play per snap.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TrackedPlayFile } from "../src/lib/trackedPlay";
import { groupViews, mergeAll } from "../src/lib/viewMerge";

export interface TrackDir {
  /** One name per play (its first view's), in play order. */
  names: string[];
  plays: Map<string, TrackedPlayFile>;
  /** Plays whose second angle was read but didn't show the same play, so wasn't used, with a sentence for the card. */
  notes: Map<string, string>;
  /** Plays with a second angle that was merged. */
  merged: number;
}

export function loadTrackDir(dir: string): TrackDir {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const groups = groupViews(files);
  const names = [...groups.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const plays = new Map<string, TrackedPlayFile>();
  const notes = new Map<string, string>();
  let merged = 0;
  for (const name of names) {
    const views = groups.get(name)!.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as TrackedPlayFile);
    if (views.length === 1) {
      plays.set(name, views[0]);
      continue;
    }
    const result = mergeAll(views);
    plays.set(name, result.file);
    if (result.reports.some((r) => r.used)) merged++;
    if (result.reports.some((r) => !r.used)) {
      notes.set(name, "A second angle was filmed but didn't line up with this one, so only this view was read.");
    }
  }
  return { names, plays, notes, merged };
}

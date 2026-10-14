/**
 * Names each tracked player's route.
 *
 *   npx jiti scripts/read-routes.ts tracks.json [out.json]
 *
 * `tracks.json` is what `python -m eval.tracks` writes: players followed through a play, in
 * yards from the ball at the snap, in the offense's own view (x to its right, y upfield).
 * Every offensive player who left his spot gets `readRoute` (src/lib/routeReader.ts), the
 * same reader the cards use, so there is one place a route gets its name.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { readRoute } from "../src/lib/routeReader";

interface Track {
  id: number;
  team: "offense" | "defense";
  start: [number, number];
  points: [number, number, number][]; // seconds, x, y
}

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error("usage: npx jiti scripts/read-routes.ts tracks.json [out.json]");
  process.exit(2);
}

const data = JSON.parse(readFileSync(input, "utf8")) as { tracks: Track[] };
const reads = data.tracks
  .filter((t) => t.team === "offense")
  .map((t) => {
    const path = t.points.map(([, x, y]) => ({ x, y }));
    // His sideline: the side of the ball he lined up on (the middle goes to his right).
    const outside = t.start[0] < 0 ? -1 : 1;
    const read = readRoute(path, outside, -t.start[1]);
    return {
      id: t.id,
      start: t.start,
      route: read.kind,
      confidence: Number(read.confidence.toFixed(2)),
      distance: Number(read.distance.toFixed(2)),
      next: read.ranked.slice(0, 3).map((r) => r.kind),
    };
  });

const text = JSON.stringify({ reads }, null, 2);
if (output) writeFileSync(output, text);
else console.log(text);

import type { RouteKind } from "./formations";

/**
 * Named pass concepts ("MESH", "SMASH") → a distinct route for each
 * position, so a concept call draws as the concept instead of one route
 * repeated across every receiver.
 *
 * Positions are by play side, outside in, so a template works from any
 * formation and mirrors with the play: `ps1` is the play-side #1 (outside
 * receiver), `ps2` the play-side #2, `bs1` / `bs2` the backside #1 / #2, and
 * `back` the back in the backfield. In Deuces going right that's Z / Y, X / F,
 * and H.
 *
 * A route is either a route-tree kind, drawn with the staff's own technique
 * (formations.ts `routePath`: post and corner off a 10-yard stem, and so on),
 * or a vector in yards for routes off the tree (drags, rail, sail, deep dig).
 */

export type ConceptSlot = "ps1" | "ps2" | "ps3" | "bs1" | "bs2" | "back";

export interface ConceptRoute {
  /** What the card writes at the arrow tip for a vector route ("DRAG", "RAIL"). */
  type: string;
  /** A route-tree / named kind, drawn exactly like the same route anywhere else on a card. */
  tree?: RouteKind;
  /** Vector route: yards straight up before the break. */
  stemY?: number;
  /** Vector route: yards across from the player at the end of the route. */
  breakX?: number;
  /** Vector route: depth (yards past the line of scrimmage) at the end of the route. */
  breakY?: number;
  /** Which way `breakX` runs: toward this player's own sideline (default), or inside. */
  toward?: "outside" | "inside" | "playside" | "backside";
  /**
   * Rail / wheel: out to the flat at `stemY`, then straight up the field
   * `fromSideline` yards in from the sideline it's heading to, to `breakY`.
   */
  vertical?: boolean;
  fromSideline?: number;
  /** Assignment-table text. */
  job: string;
}

export interface Concept {
  /** Words that must all appear in the play call ("MESH", "RAIL"). */
  keywords: string[];
  /**
   * Only match when the call has no other route words: CROSS is also a plain
   * route word ("FADE CROSS"), so it's the concept only when it stands alone.
   */
  exclusive?: boolean;
  /** Route per position; the first position that exists in the formation takes it. */
  routes: { who: ConceptSlot[]; route: ConceptRoute }[];
}

const tree = (kind: RouteKind, job: string): ConceptRoute => ({ type: kind.toUpperCase(), tree: kind, job });

const drag = (depth: number, job: string): ConceptRoute => ({
  type: "DRAG",
  stemY: depth,
  breakX: 20,
  breakY: depth,
  toward: "inside",
  job,
});

export const CONCEPT_DICTIONARY: Record<string, Concept> = {
  MESH: {
    // The inside receivers cross over the ball at 3-5 yards: the backside one
    // sets the mesh at 5, the play-side one runs under him at 3; post / corner outside.
    keywords: ["MESH"],
    routes: [
      { who: ["bs1"], route: tree("post", "8 Post") },
      { who: ["bs2"], route: drag(5, "Mesh drag at 5, sets the mesh") },
      { who: ["ps2"], route: drag(3, "Mesh drag at 3, under") },
      { who: ["ps1"], route: tree("corner", "7 Corner") },
    ],
  },
  FLOOD: {
    // Three levels to the play side: clear, sail, flat.
    keywords: ["FLOOD"],
    routes: [
      { who: ["ps1"], route: tree("go", "Go: clear the corner") },
      {
        who: ["ps2"],
        route: { type: "SAIL", stemY: 8, breakX: 8, breakY: 14, toward: "outside", job: "Sail: 8 up, out to 14" },
      },
      { who: ["ps3", "back"], route: tree("flat", "Flat") },
      { who: ["bs1"], route: tree("dig", "Dig") },
      { who: ["bs2"], route: tree("post", "8 Post") },
    ],
  },
  SMASH: {
    // Hitch / corner high-low on both sides.
    keywords: ["SMASH"],
    routes: [
      { who: ["ps1"], route: tree("hitch", "Hitch at 5") },
      { who: ["ps2"], route: tree("corner", "7 Corner") },
      { who: ["bs1"], route: tree("hitch", "Hitch at 5") },
      { who: ["bs2"], route: tree("corner", "7 Corner") },
    ],
  },
  DAGGER: {
    // #2 clears the seam, #1 runs the deep dig under it.
    keywords: ["DAGGER"],
    routes: [
      { who: ["ps2"], route: tree("go", "Seam: clear the safety") },
      {
        who: ["ps1"],
        route: { type: "DIG", stemY: 15, breakX: 12, breakY: 15, toward: "inside", job: "Dig at 15" },
      },
      { who: ["bs1"], route: tree("post", "8 Post") },
      { who: ["bs2"], route: tree("hitch", "Hitch at 5") },
    ],
  },
  CROSS: {
    // Backside #2 crosses deep to the play side; the play side clears.
    keywords: ["CROSS"],
    exclusive: true,
    routes: [
      {
        who: ["bs2"],
        route: { type: "CROSS", stemY: 6, breakX: 25, breakY: 14, toward: "inside", job: "Deep cross at 14" },
      },
      { who: ["bs1"], route: tree("post", "8 Post") },
      { who: ["ps1"], route: tree("go", "Go: clear") },
      { who: ["ps2"], route: tree("curl", "4 Curl") },
    ],
  },
};

/**
 * The back's own tag, separate from the receivers' concept: RAIL (or WHEEL)
 * rides on top of any concept ("MESH RAIL", "SMASH RAIL") and sends the back
 * out to the backside flat and up the sideline, under the backside #1.
 */
export const BACK_TAGS: Record<string, ConceptRoute> = {
  RAIL: {
    type: "RAIL",
    stemY: 1,
    breakY: 18,
    toward: "backside",
    vertical: true,
    fromSideline: 8,
    job: "Rail up the sideline",
  },
  WHEEL: {
    type: "WHEEL",
    stemY: 1,
    breakY: 18,
    toward: "backside",
    vertical: true,
    fromSideline: 8,
    job: "Wheel",
  },
};

/** Whole words of a play call, upper-cased ("Mesh-Rail rt" → MESH, RAIL, RT). */
export function callWords(playCall: string): string[] {
  return playCall
    .toUpperCase()
    .replace(/[^A-Z0-9#]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.replace(/^(MESH|RAIL|WHEEL|FLOOD|SMASH|DAGGER|CROSS)(ES|S)$/, "$1"));
}

/**
 * The concept a play call names ("MESH", "SMASH"), any back tag riding on it
 * ("RAIL"), and the call's remaining words for the caller to read as extra
 * routes. A back tag on its own isn't a concept: "RAIL" alone returns null.
 */
export function matchConcept(
  playCall: string,
): { key: string; concept: Concept; backTag: ConceptRoute | null; otherWords: string[] } | null {
  const ws = callWords(playCall);
  const keys = Object.keys(CONCEPT_DICTIONARY).sort(
    (a, b) => CONCEPT_DICTIONARY[b].keywords.length - CONCEPT_DICTIONARY[a].keywords.length,
  );
  for (const key of keys) {
    const concept = CONCEPT_DICTIONARY[key];
    if (!concept.keywords.every((k) => ws.includes(k))) continue;
    const tagWord = ws.find((w) => BACK_TAGS[w]);
    return {
      key,
      concept,
      backTag: tagWord ? BACK_TAGS[tagWord] : null,
      otherWords: ws.filter((w) => !concept.keywords.includes(w) && w !== tagWord),
    };
  }
  return null;
}

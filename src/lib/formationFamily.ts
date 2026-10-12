/**
 * The staff's own formation names, as a "family" the defense's looks are matched on.
 *
 * `FormationKey` (hudlParser.ts) is the shape the app *draws*: seven of them, so Twins is drawn as Pro and Aces and Duces
 * are both drawn as Spread. A defense doesn't treat those alike: it lines up differently against Twins than against Pro, and
 * against Aces (a tight end, three wide) than against Duces (2x2). So everything that asks "what did they do against this
 * formation?" (the front a rep is drawn against, where the corners and safeties stand) keys on the family, and falls back to
 * the drawn shape only where there is no film against that exact formation.
 *
 * The same words come from three places and have to land on the same family: the practice script ("Twins Rt", "Aces Left",
 * "Duces Gun", "Trio Rt"), the opponent's breakdown, and the film analyzer's own name for what it saw (`staff_name` in
 * `video-service/eval/formation.py`: "deuces gun", "trio gun right", "aces", "twins right", "bunch gun").
 *
 * Framework-free, so Vitest and the Node scripts run it directly.
 */

import { classifyFormation, type FormationKey } from "./hudlParser";

export type FormationFamily =
  | "pro"
  | "twins"
  | "aces"
  | "duces"
  | "trio"
  | "empty"
  | "bunch"
  | "i-form"
  | "double-eagle"
  | "split-pro"
  | "spread"
  | "unknown";

export const FAMILY_LABELS: Record<FormationFamily, string> = {
  pro: "Pro",
  twins: "Twins",
  aces: "Aces",
  duces: "Duces",
  trio: "Trio",
  empty: "Empty",
  bunch: "Bunch",
  "i-form": "I-Form",
  "double-eagle": "Wing T",
  "split-pro": "Split Pro",
  spread: "Spread",
  unknown: "Other",
};

/** Words, most specific first (a "Twins" is never read as "Pro" because it also says PRO somewhere). */
const WORDS: [FormationFamily, RegExp][] = [
  ["bunch", /\bBUNCH\b/],
  ["empty", /\bEMPTY\b/],
  ["aces", /\bACES?\b/],
  ["duces", /\b(DUCES?|DEUCES?)\b/],
  ["twins", /\bTWINS?\b/],
  ["trio", /\b(TRIO|TRIPS|TREY|TRIPLE)\b/],
  ["double-eagle", /\bWING\s*T\b|\b(DOUBLE|DBL|DBLE)\s*EAGLE\b|\bEAGLE\b/],
  ["split-pro", /\bSPLIT(S|\s*BACKS?)?\b/],
  ["i-form", /\b(I|IFORM|I\s*FORM|POWER\s*I|TIGHT\s*I|SLOT\s*I|MAX\s*I)\b/],
  ["pro", /\bPRO\b/],
  ["spread", /\b(SPREAD|DOUBLES|DBLS|2X2|SHOTGUN|GUN)\b/],
];

const FROM_KEY: Record<FormationKey, FormationFamily> = {
  pro: "pro",
  trips: "trio",
  spread: "spread",
  "i-form": "i-form",
  "double-eagle": "double-eagle",
  "split-pro": "split-pro",
  unknown: "unknown",
};

/** The formation family a piece of text names; where it names none, the shape it draws as (`key`, or classified from the text). */
export function formationFamily(text: string, key?: FormationKey): FormationFamily {
  const upper = text.toUpperCase().replace(/[-/_.,()]/g, " ").replace(/\s+/g, " ");
  for (const [family, pattern] of WORDS) if (pattern.test(upper)) return family;
  return FROM_KEY[key ?? classifyFormation(text)];
}

/** The key a family is stored under in per-formation tables (kept apart from the shape keys, which can't collide with these). */
export const familyKey = (family: FormationFamily): string => `fam:${family}`;

/** Families whose name says more than the shape they draw as does (Spread and Other say nothing more). */
export function isSpecificFamily(family: FormationFamily): boolean {
  return family !== "spread" && family !== "unknown";
}

/** Whether the same family or just the same shape: used by the UI to say what a match was made on. */
export function sameShape(a: FormationFamily, b: FormationFamily): boolean {
  return FAMILY_SHAPE[a] === FAMILY_SHAPE[b];
}

const FAMILY_SHAPE: Record<FormationFamily, FormationKey> = {
  pro: "pro",
  twins: "pro",
  aces: "spread",
  duces: "spread",
  empty: "spread",
  trio: "trips",
  bunch: "trips",
  "i-form": "i-form",
  "double-eagle": "double-eagle",
  "split-pro": "split-pro",
  spread: "spread",
  unknown: "unknown",
};

/** The shape a family is drawn as. */
export const familyShape = (family: FormationFamily): FormationKey => FAMILY_SHAPE[family];

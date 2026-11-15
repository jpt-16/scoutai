/**
 * What a COVERAGE tag names, read from its text. Kept apart from `coverageRead.ts` (which reads coverage off film and
 * so pulls the whole tracker's code in) so the reader's reports can use it without that weight. Framework-free.
 */

export type CoverageFamily = "0" | "1" | "2" | "2-man" | "tampa-2" | "3" | "4";

/**
 * The coverage family a COVERAGE tag names ("C3", "Cover 3 Sky", "Quarters", "Tampa"), for scoring against a sheet. A
 * number this staff doesn't use as a coverage (no Cover 5 or 6; their sheets also carry calls like "6 - DOUBLE FIRE")
 * names none.
 */
export function coverageFamilyOf(tag: string): CoverageFamily | null {
  const t = ` ${tag.toUpperCase().replace(/[^A-Z0-9]+/g, " ")} `;
  if (/ TAMPA /.test(t)) return "tampa-2";
  if (/ (QUARTERS|QTRS|QUARTER) /.test(t)) return "4";
  if (/ (2 MAN|TWO MAN|COVER 5|C5) /.test(t)) return "2-man";
  const n = t.match(/ (?:COVER|CVR|CV|C)? ?([0-9]) /)?.[1] ?? t.match(/ C([0-9])/)?.[1];
  if (n === "0" || n === "1" || n === "2" || n === "3" || n === "4") return n;
  if (/ (ZERO) /.test(t)) return "0";
  return null;
}

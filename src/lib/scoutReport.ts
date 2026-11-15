/**
 * The scouting report for a whole script: what the opponent's defense shows (fronts, blitz, coverage) and what their
 * offense does (run / pass by down, distance and formation, the calls they lean on), under one set of situational
 * filters, each number with the plays behind it so a coach can open them.
 *
 * It follows how a staff breaks a team down: pick the situation (3rd down, long yardage, from Trips), read what they do
 * in it, and finish with where to attack. The last step is `insights`: plain sentences, each carrying its sample size,
 * written only where the plays say enough (`MIN_SNAPS`, `MIN_TOTAL`): "Blitzed 4 of 6 snaps on 3rd down (67%) against
 * 25% overall". A film script with no coverage tag simply has nothing to say about coverage; it never reads as "never
 * blitzes".
 *
 * Framework-free: reads cards, returns numbers and play ids.
 */

import { coverageFamilyOf, type CoverageFamily } from "./coverageTag";
import { FAMILY_LABELS, formationFamily, type FormationFamily } from "./formationFamily";
import { inPeriod, playKind } from "./formations";
import type { Hash, HudlPlayCard } from "./hudlParser";
import { parsePressure } from "./pressure";
import { distanceBucketLabel } from "./tendencies";

/** Fewest snaps a slice needs before a sentence is written about it. */
export const MIN_SNAPS = 4;
/** Fewest tagged snaps overall before any sentence is written. */
export const MIN_TOTAL = 8;
/** How far (in points of percent) a slice must sit from the whole before it is worth saying. */
export const MIN_SWING = 20;
/** Fewest plays with a readable gain before an average gain is shown. */
const MIN_GAIN_PLAYS = 3;

export type DistanceBucket = "Short" | "Medium" | "Long";

/** The situation the whole report is read in. Unset fields mean "any". */
export interface ReportFilter {
  down?: number | null;
  distance?: DistanceBucket | null;
  family?: FormationFamily | null;
  hash?: Hash | null;
}

export interface Bucket {
  key: string;
  label: string;
  count: number;
  /** 0-100, rounded, of the base this bucket was counted against. */
  pct: number;
  /** The plays in it, for "show me these". */
  ids: string[];
  /** Average gain over the plays whose result reads as yards, when there are enough of them. */
  gain: { avg: number; plays: number } | null;
}

export interface Insight {
  text: string;
  /** How many snaps the sentence rests on. */
  n: number;
  /** The plays it is about. */
  ids: string[];
}

/* ------------------------------------------------------------------ small readers */

const pct = (n: number, d: number) => (d > 0 ? Math.round((n * 100) / d) : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Yards a play's RESULT says it gained ("Gain 6", "Loss 3", "-2", "Inc"), or null when it doesn't say plainly (a penalty, a score). */
export function parseGain(result: string): number | null {
  const t = result.trim().toUpperCase();
  if (!t || /\bPEN/.test(t)) return null;
  if (/^INC(OMPLETE)?\b/.test(t)) return 0;
  const loss = t.match(/\bLOSS(?: OF)?\s*(\d+)/);
  if (loss) return -Number(loss[1]);
  const gain = t.match(/\bGAIN(?: OF)?\s*(-?\d+)/);
  if (gain) return Number(gain[1]);
  if (/^[+-]?\d+$/.test(t)) return Number(t);
  return null;
}

export function familyOf(card: Pick<HudlPlayCard, "formation" | "formationKey">): FormationFamily {
  return formationFamily(card.formation, card.formationKey);
}

export function familyLabel(family: FormationFamily): string {
  return family === "unknown" ? "Not recognized" : FAMILY_LABELS[family];
}

/** The cards that are in a filter's situation. */
export function applyReportFilter(cards: HudlPlayCard[], filter: ReportFilter): HudlPlayCard[] {
  return cards.filter(
    (c) =>
      (filter.down == null || c.down === filter.down) &&
      (filter.distance == null || (c.down != null && distanceBucketLabel(c) === filter.distance)) &&
      (filter.family == null || familyOf(c) === filter.family) &&
      (filter.hash == null || c.hash === filter.hash),
  );
}

/** Whether a filter narrows anything. */
export function isFiltered(filter: ReportFilter): boolean {
  return filter.down != null || filter.distance != null || filter.family != null || filter.hash != null;
}

/** A sentence for a filter: "3rd down, Long, from Trio". */
export function describeFilter(filter: ReportFilter): string {
  const parts: string[] = [];
  if (filter.down != null) parts.push(`${["", "1st", "2nd", "3rd", "4th"][filter.down] ?? `${filter.down}th`} down`);
  if (filter.distance) parts.push(`${filter.distance.toLowerCase()} yardage`);
  if (filter.family) parts.push(`from ${familyLabel(filter.family)}`);
  if (filter.hash) parts.push(`${{ L: "left", M: "middle", R: "right" }[filter.hash]} hash`);
  return parts.length ? parts.join(", ") : "all plays";
}

function gainOf(cards: HudlPlayCard[]): Bucket["gain"] {
  const gains = cards.map((c) => parseGain(c.result)).filter((g): g is number => g != null);
  if (gains.length < MIN_GAIN_PLAYS) return null;
  return { avg: round1(gains.reduce((a, b) => a + b, 0) / gains.length), plays: gains.length };
}

interface Entry {
  key: string;
  label: string;
  card: HudlPlayCard;
}

function bucketize(entries: Entry[], base: number): Bucket[] {
  const groups = new Map<string, { label: string; cards: HudlPlayCard[] }>();
  for (const e of entries) {
    const g = groups.get(e.key) ?? { label: e.label, cards: [] };
    g.cards.push(e.card);
    groups.set(e.key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      label: g.label,
      count: g.cards.length,
      pct: pct(g.cards.length, base),
      ids: g.cards.map((c) => c.id),
      gain: gainOf(g.cards),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const DOWN_NAMES = ["", "1st", "2nd", "3rd", "4th"];
const downName = (d: number) => DOWN_NAMES[d] ?? `${d}th`;

/* ------------------------------------------------------------------ their defense */

const MAN: ReadonlySet<CoverageFamily> = new Set(["0", "1", "2-man"]);

function coverageLabel(family: CoverageFamily): string {
  if (family === "2-man") return "2 Man";
  if (family === "tampa-2") return "Tampa 2";
  if (family === "4") return "Cover 4";
  return `Cover ${family}`;
}

type DefenseKind =
  | { kind: "blitz"; label: string }
  | { kind: "cover"; family: CoverageFamily }
  | { kind: "other"; label: string }
  | { kind: "untagged" };

/** What a play's COVERAGE column says: a blitz call (this staff writes those there), a coverage, something else, or nothing. */
export function readDefenseTag(card: Pick<HudlPlayCard, "coverage">): DefenseKind {
  const tag = card.coverage.trim();
  if (!tag) return { kind: "untagged" };
  const pressure = parsePressure(tag);
  if (pressure) {
    return { kind: "blitz", label: pressure.rushers ? `${pressure.rushers} rush · ${pressure.call}` : pressure.call };
  }
  const family = coverageFamilyOf(tag);
  return family ? { kind: "cover", family } : { kind: "other", label: tag.toUpperCase() };
}

export interface DownRate {
  down: number;
  /** Snaps with a coverage or blitz tag on this down. */
  tagged: number;
  blitz: number;
  /** 0-100, of the tagged snaps. */
  rate: number;
  ids: string[];
}

export interface DefenseReport {
  unit: "defense";
  total: number;
  /** Their fronts as the staff wrote them, "Untagged" last. Counted against every play. */
  fronts: Bucket[];
  /** Coverages on the plays that weren't a blitz. Counted against the tagged ones. */
  coverages: Bucket[];
  manZone: { man: number; zone: number; ids: { man: string[]; zone: string[] } };
  pressure: {
    /** Plays with a coverage or blitz tag: what a rate is a rate of. */
    tagged: number;
    blitz: number;
    rate: number;
    blitzIds: string[];
    calls: Bucket[];
    byDown: DownRate[];
  };
  /** Plays with no coverage / blitz tag at all. */
  untagged: number;
  insights: Insight[];
}

export function defenseReport(allCards: HudlPlayCard[], filter: ReportFilter = {}): DefenseReport {
  const cards = applyReportFilter(
    allCards.filter((c) => inPeriod(c, "all", "defense")),
    filter,
  );
  const tags = cards.map((card) => ({ card, tag: readDefenseTag(card) }));
  const tagged = tags.filter((t) => t.tag.kind !== "untagged");
  const blitzes = tags.filter((t) => t.tag.kind === "blitz");
  const covers = tags.filter((t) => t.tag.kind !== "blitz" && t.tag.kind !== "untagged");

  const fronts = bucketize(
    cards.map((card) => {
      const text = card.defFront.trim().toUpperCase();
      return { key: text || "—", label: text || "Untagged", card };
    }),
    cards.length,
  ).sort((a, b) => Number(a.key === "—") - Number(b.key === "—") || b.count - a.count);

  const coverages = bucketize(
    covers.map(({ card, tag }) =>
      tag.kind === "cover"
        ? { key: tag.family, label: coverageLabel(tag.family), card }
        : { key: `other:${tag.kind === "other" ? tag.label : ""}`, label: tag.kind === "other" ? tag.label : "", card },
    ),
    covers.length,
  );

  const manIds = covers.filter((t) => t.tag.kind === "cover" && MAN.has(t.tag.family)).map((t) => t.card.id);
  const zoneIds = covers.filter((t) => t.tag.kind === "cover" && !MAN.has(t.tag.family)).map((t) => t.card.id);

  const calls = bucketize(
    blitzes.map(({ card, tag }) => ({ key: tag.kind === "blitz" ? tag.label : "", label: tag.kind === "blitz" ? tag.label : "", card })),
    blitzes.length,
  );

  const byDown: DownRate[] = [1, 2, 3, 4]
    .map((down) => {
      const onDown = tagged.filter((t) => t.card.down === down);
      const blitz = onDown.filter((t) => t.tag.kind === "blitz");
      return { down, tagged: onDown.length, blitz: blitz.length, rate: pct(blitz.length, onDown.length), ids: blitz.map((t) => t.card.id) };
    })
    .filter((d) => d.tagged > 0);

  const report: DefenseReport = {
    unit: "defense",
    total: cards.length,
    fronts,
    coverages,
    manZone: { man: manIds.length, zone: zoneIds.length, ids: { man: manIds, zone: zoneIds } },
    pressure: {
      tagged: tagged.length,
      blitz: blitzes.length,
      rate: pct(blitzes.length, tagged.length),
      blitzIds: blitzes.map((t) => t.card.id),
      calls,
      byDown,
    },
    untagged: cards.length - tagged.length,
    insights: [],
  };
  report.insights = defenseInsights(report, filter);
  return report;
}

function defenseInsights(r: DefenseReport, filter: ReportFilter): Insight[] {
  const out: Insight[] = [];
  const { pressure } = r;
  if (pressure.tagged >= MIN_TOTAL) {
    out.push({
      text:
        pressure.blitz === 0
          ? `No blitz in ${pressure.tagged} tagged snaps.`
          : `Blitzed ${pressure.blitz} of ${pressure.tagged} tagged snaps (${pressure.rate}%).`,
      n: pressure.tagged,
      ids: pressure.blitzIds,
    });
    // Downs where they blitz far more than they do overall get a line each; the ones where they blitz far less are one
    // line ("Blitz less on 1st and 2nd down"), since they say the same thing. Skipped when a down is already picked.
    if (filter.down == null) {
      const apart = pressure.byDown.filter((d) => d.tagged >= MIN_SNAPS && Math.abs(d.rate - pressure.rate) >= MIN_SWING);
      for (const d of apart.filter((x) => x.rate > pressure.rate)) {
        out.push({
          text: `Blitz more on ${downName(d.down)} down: ${d.blitz} of ${d.tagged} (${d.rate}%) against ${pressure.rate}% overall.`,
          n: d.tagged,
          ids: d.ids,
        });
      }
      const less = apart.filter((x) => x.rate < pressure.rate);
      if (less.length > 0) {
        const blitz = less.reduce((n, d) => n + d.blitz, 0);
        const snaps = less.reduce((n, d) => n + d.tagged, 0);
        out.push({
          text: `Blitz less on ${less.map((d) => downName(d.down)).join(" and ")} down: ${blitz} of ${snaps} (${pct(blitz, snaps)}%) against ${pressure.rate}% overall.`,
          n: snaps,
          ids: less.flatMap((d) => d.ids),
        });
      }
    }
  }
  const covered = r.coverages.reduce((n, b) => n + b.count, 0);
  const top = r.coverages.find((b) => !b.key.startsWith("other:"));
  if (covered >= MIN_TOTAL && top && top.count >= MIN_SNAPS && top.pct >= 40) {
    out.push({ text: `${top.label} on ${top.count} of ${covered} non-blitz snaps (${top.pct}%).`, n: covered, ids: top.ids });
  }
  const { man, zone } = r.manZone;
  if (man + zone >= MIN_TOTAL) {
    const lean = man >= zone ? "man" : "zone";
    const n = Math.max(man, zone);
    if (pct(n, man + zone) >= 65) {
      out.push({ text: `Plays ${lean} on ${n} of ${man + zone} snaps (${pct(n, man + zone)}%).`, n: man + zone, ids: r.manZone.ids[lean] });
    }
  }
  const front = r.fronts.find((b) => b.key !== "—");
  const fronted = r.fronts.filter((b) => b.key !== "—").reduce((n, b) => n + b.count, 0);
  if (front && fronted >= MIN_TOTAL && front.count >= MIN_SNAPS && pct(front.count, fronted) >= 50) {
    out.push({ text: `${front.label} front on ${front.count} of ${fronted} snaps (${pct(front.count, fronted)}%).`, n: fronted, ids: front.ids });
  }
  return out;
}

/* ------------------------------------------------------------------ their offense */

export interface SplitRow {
  key: string;
  label: string;
  total: number;
  run: number;
  pass: number;
  /** 0-100, of the runs and passes (an RPO or an untyped play is in neither). */
  runPct: number;
  ids: string[];
  runIds: string[];
  passIds: string[];
}

export interface OffenseReport {
  unit: "offense";
  total: number;
  run: number;
  pass: number;
  /** RPOs and plays whose call said neither. */
  other: number;
  runPct: number;
  /** Every play in one row, so the overall split opens its plays like the others. */
  overall: SplitRow;
  byDown: SplitRow[];
  byDistance: SplitRow[];
  formations: SplitRow[];
  /** The kinds of play they call, from the play-call's concept, runs and passes alike. */
  calls: Bucket[];
  /** Where their runs go, from plays whose direction the sheet or film gave. */
  runDirection: { left: number; right: number; leftIds: string[]; rightIds: string[] };
  insights: Insight[];
}

type Kind = "run" | "pass" | "other";

function kindOf(card: Pick<HudlPlayCard, "playCall" | "concept">): Kind {
  const k = playKind(card);
  return k === "run" ? "run" : k === "pass" || k === "pa" ? "pass" : "other";
}

function splitRow(key: string, label: string, cards: HudlPlayCard[]): SplitRow {
  const run = cards.filter((c) => kindOf(c) === "run");
  const pass = cards.filter((c) => kindOf(c) === "pass");
  return {
    key,
    label,
    total: cards.length,
    run: run.length,
    pass: pass.length,
    runPct: pct(run.length, run.length + pass.length),
    ids: cards.map((c) => c.id),
    runIds: run.map((c) => c.id),
    passIds: pass.map((c) => c.id),
  };
}

const humanize = (concept: string) => concept.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

export function offenseReport(allCards: HudlPlayCard[], filter: ReportFilter = {}): OffenseReport {
  const cards = applyReportFilter(
    allCards.filter((c) => inPeriod(c, "all", "offense")),
    filter,
  );
  const kinds = cards.map(kindOf);
  const run = kinds.filter((k) => k === "run").length;
  const pass = kinds.filter((k) => k === "pass").length;

  const byDown = [1, 2, 3, 4]
    .map((d) => splitRow(`down:${d}`, `${downName(d)} down`, cards.filter((c) => c.down === d)))
    .filter((r) => r.total > 0);
  const byDistance = (["Short", "Medium", "Long"] as const)
    .map((b) => splitRow(`dist:${b}`, `${b} yardage`, cards.filter((c) => c.down != null && distanceBucketLabel(c) === b)))
    .filter((r) => r.total > 0);

  const families = new Map<FormationFamily, HudlPlayCard[]>();
  for (const c of cards) {
    if (!c.formation.trim()) continue;
    const f = familyOf(c);
    families.set(f, [...(families.get(f) ?? []), c]);
  }
  const formations = [...families.entries()]
    .map(([f, list]) => splitRow(`fam:${f}`, familyLabel(f), list))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));

  const calls = bucketize(
    cards
      .filter((c) => c.concept !== "unknown")
      .map((card) => ({ key: card.concept, label: humanize(card.concept), card })),
    cards.length,
  );

  const runs = cards.filter((c) => kindOf(c) === "run");
  const dir = (c: HudlPlayCard) => c.playDir.trim().toUpperCase().charAt(0);
  const left = runs.filter((c) => dir(c) === "L");
  const right = runs.filter((c) => dir(c) === "R");

  const report: OffenseReport = {
    unit: "offense",
    total: cards.length,
    run,
    pass,
    other: cards.length - run - pass,
    runPct: pct(run, run + pass),
    overall: splitRow("all", "All plays", cards),
    byDown,
    byDistance,
    formations,
    calls,
    runDirection: { left: left.length, right: right.length, leftIds: left.map((c) => c.id), rightIds: right.map((c) => c.id) },
    insights: [],
  };
  report.insights = offenseInsights(report, filter);
  return report;
}

/** "they run 5 of 6 (83%)" — the side the row leans to. */
function lean(row: SplitRow): { side: "run" | "pass"; n: number; of: number; pct: number; ids: string[] } {
  const of = row.run + row.pass;
  const side = row.run >= row.pass ? "run" : "pass";
  const n = Math.max(row.run, row.pass);
  return { side, n, of, pct: pct(n, of), ids: side === "run" ? row.runIds : row.passIds };
}

function offenseInsights(r: OffenseReport, filter: ReportFilter): Insight[] {
  const out: Insight[] = [];
  const decided = r.run + r.pass;
  if (decided >= MIN_TOTAL) {
    out.push({ text: `Run ${r.run} of ${decided} plays (${r.runPct}%), pass ${r.pass} (${100 - r.runPct}%).`, n: decided, ids: [] });
  }
  if (decided >= MIN_TOTAL) {
    const rows = [...(filter.down == null ? r.byDown : []), ...(filter.distance == null ? r.byDistance : [])];
    for (const row of rows) {
      const l = lean(row);
      if (l.of < MIN_SNAPS || Math.abs(row.runPct - r.runPct) < MIN_SWING || l.pct < 65) continue;
      out.push({ text: `${row.label}: ${l.side} ${l.n} of ${l.of} (${l.pct}%), against ${l.side === "run" ? r.runPct : 100 - r.runPct}% overall.`, n: l.of, ids: l.ids });
    }
    if (filter.family == null) {
      for (const row of r.formations) {
        const l = lean(row);
        if (l.of < MIN_SNAPS || l.pct < 75) continue;
        out.push({ text: `From ${row.label}: ${l.side} ${l.n} of ${l.of} (${l.pct}%).`, n: l.of, ids: l.ids });
      }
    }
  }
  const { left, right } = r.runDirection;
  if (left + right >= MIN_TOTAL) {
    const side = right >= left ? "right" : "left";
    const n = Math.max(left, right);
    if (pct(n, left + right) >= 65) {
      out.push({ text: `Runs go ${side} ${n} of ${left + right} times (${pct(n, left + right)}%).`, n: left + right, ids: side === "right" ? r.runDirection.rightIds : r.runDirection.leftIds });
    }
  }
  return out;
}

/** The families present in a set of cards, most common first, for the report's formation filter. */
export function familiesIn(cards: HudlPlayCard[]): { family: FormationFamily; count: number }[] {
  const counts = new Map<FormationFamily, number>();
  for (const c of cards) {
    if (!c.formation.trim()) continue;
    const f = familyOf(c);
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts.entries()].map(([family, count]) => ({ family, count })).sort((a, b) => b.count - a.count);
}

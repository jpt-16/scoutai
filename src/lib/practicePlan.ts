import { FAMILY_LABELS, familyKey, formationFamily, type FormationFamily } from "./formationFamily";
import { inPeriod, playKind } from "./formations";
import { dbAlignmentFor, type DbAlignment, type DbAlignments } from "./secondary";
import { notifyLocalChange } from "./syncMeta";
import {
  classifyConcept,
  classifyFormation,
  deriveCard,
  parseHash,
  parseSide,
  parseSideTag,
  type FormationKey,
  type Hash,
  type HudlPlayCard,
} from "./hudlParser";

/**
 * The staff's practice playsheet: for each day, the periods in order (7v7 or
 * team), and for each period which side of the ball is "ours".
 *
 * - Our offense's period → the scout **defense** reads from our playsheet: the
 *   coach pastes the calls he'll read, in order, and each becomes a Scout D card
 *   (our formation, the opponent's front and coverage from film).
 * - Our defense's period → the scout **offense** runs the opponent's plays from
 *   film as usual; the defensive coach calls his own defense, so there's no list.
 *
 * The pasted text stays the source of truth, in the staff's own format, so the
 * playsheet never has to change shape for the app.
 */

const STORAGE_KEY = "scoutcard:practice:v1";

export type PeriodKind = "7v7" | "team";
/** Which of OUR units is working: offense → scout D cards; defense → scout O cards. */
export type PeriodSide = "offense" | "defense";

export interface PracticePeriod {
  id: string;
  /** Free label from the playsheet ("Period 6", "P6 · 3:50"). */
  name: string;
  kind: PeriodKind;
  side: PeriodSide;
  /** Offense periods: the calls, one per line, pasted as the playsheet has them. */
  text: string;
}

export interface PracticeDay {
  id: string;
  /** "Mon", "Tuesday", "Thu walkthrough". */
  name: string;
  periods: PracticePeriod[];
}

export interface PracticePlan {
  days: PracticeDay[];
  /**
   * The staff's own formation names ("REX", "LIZ") → the shape to draw, keyed
   * by the upper-cased first word of the call.
   */
  formationAliases: Record<string, FormationKey>;
}

/** One line of the playsheet, read. */
export interface PlaysheetRep {
  /** The call as the coach will read it, cleaned up ("TRIPS RT 836"). */
  call: string;
  /** The formation part (first cell of a pasted row, else the whole call). */
  formation: string;
  /** The personnel package a script names ("Boston", "Miami"), kept apart from the call. */
  personnel?: string;
  hash: Hash | null;
  /** A look written on the playsheet after "vs" ("vs 3-4 C1"). */
  look: { front: string; coverage: string } | null;
  /** 0-based line in the period's text, so the editor can rewrite it. */
  line: number;
}

/** A defensive look the opponent showed on film. */
export interface ScoutLook {
  /** Normalized "FRONT|COVERAGE", for matching and pickers. */
  key: string;
  front: string;
  coverage: string;
  count: number;
  /** How often it showed up against each formation: by drawn shape (`"trips"`) and by formation family (`"fam:trio"`). */
  vs: Record<string, number>;
  /** Against each formation and kind of play: key `"trips|pass"` or `"fam:trio|pass"`. */
  vsKind: Record<string, number>;
}

/** Run or pass, the split a defense calls differently against. */
export type RepKind = "run" | "pass";

/** Run or pass for a call ("DUO RT", "BUBBLE RT"), or null when it can't be told. */
export function repKind(call: string): RepKind | null {
  const kind = playKind({ playCall: call, concept: classifyConcept(call) });
  return kind === "run" ? "run" : kind === "none" ? null : "pass";
}

/** At least this many film snaps against a formation and kind before the kind picks the look. */
export const MIN_KIND_REPS = 3;

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function newPeriod(
  index: number,
  kind: PeriodKind = "7v7",
  side: PeriodSide = "offense",
): PracticePeriod {
  return { id: newId("p"), name: `Period ${index + 1}`, kind, side, text: "" };
}

/** A new day: 7v7 then team, each for our offense and then our defense. */
export function newDay(name: string): PracticeDay {
  return {
    id: newId("d"),
    name,
    periods: [
      { ...newPeriod(0, "7v7", "offense") },
      { ...newPeriod(1, "7v7", "defense") },
      { ...newPeriod(2, "team", "offense") },
      { ...newPeriod(3, "team", "defense") },
    ],
  };
}

export function emptyPlan(): PracticePlan {
  return { days: [newDay(WEEKDAYS[0])], formationAliases: {} };
}

/** The next weekday name not already used by the plan. */
export function nextDayName(plan: PracticePlan): string {
  const used = new Set(plan.days.map((d) => d.name));
  return WEEKDAYS.find((d) => !used.has(d)) ?? `Day ${plan.days.length + 1}`;
}

/* -------------------------------------------------------------------------- */
/*                               Reading lines                                */
/* -------------------------------------------------------------------------- */

const VS = /\s+(?:vs\.?|v\.|versus)\s+/i;
/** A hash written out in free text: "LH", "RH", "MH", "L HASH", "LEFT HASH", "(L)". */
const HASH_TOKEN =
  /^(?:\(?\s*([LMR])\s*\)?\s*HASH|\(([LMR])\)|\[([LMR])\]|([LMR])H|(LEFT|RIGHT|MIDDLE|MID)\s+HASH)$/i;
const COVERAGE =
  /\b(COV(?:ER)?\.?\s*[0-9]\w*|C[0-9]\b|QUARTERS|QTRS|TAMPA(?:\s*2)?|MAN(?:\s*FREE)?|ZERO|PALMS?|SKY|CLOUD|BLITZ)\b/i;

function hashFromToken(token: string): Hash | null {
  const m = token.trim().match(HASH_TOKEN);
  if (!m) return null;
  return parseHash(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? "");
}

/** Splits look text into front and coverage: "4-3 OVER COV 3" → "4-3 OVER" / "COV 3". */
export function splitLook(text: string): { front: string; coverage: string } {
  const t = text.trim().replace(/\s+/g, " ");
  const m = t.match(COVERAGE);
  if (!m || m.index == null) return { front: t, coverage: "" };
  return {
    front: t
      .slice(0, m.index)
      .trim()
      .replace(/[,/·-]\s*$/, "")
      .trim(),
    coverage: t.slice(m.index).trim(),
  };
}

/**
 * Reads one playsheet line. Rows pasted from Excel / Sheets come in as tab-
 * separated cells: a leading rep number is dropped, a cell that's just a hash
 * (L / M / R) sets the hash, and the rest is the call. Typed lines can lead
 * with "1." or "3)" and carry "LH" / "R hash" and "vs 3-4 C1".
 */
const HEADER_WORD =
  /^(#|no\.?|number|number\s+play|rep|personnel|pers\.?|formation|form|play|play\s*call|call|hash|offense|offensive\s+(play|formation))$/i;

export function parsePlaysheetLine(
  text: string,
  line = 0,
  opts: { personnel?: boolean } = {},
): PlaysheetRep | null {
  const raw = text.replace(/ /g, " ").trim();
  if (!raw || /^[-=_*#\s]+$/.test(raw)) return null;
  // A title or the header row of a script ("Number | Personnel | Formation | Play").
  if (/practice\s+scripts?\s*$/i.test(raw)) return null;
  if (raw.split("\t").map((c) => c.trim()).filter(Boolean).every((c) => HEADER_WORD.test(c))) return null;

  let cells = raw.includes("\t")
    ? raw
        .split("\t")
        .map((c) => c.trim())
        .filter(Boolean)
    : [raw];
  if (cells.length === 0) return null;

  // Leading rep number: its own cell, or "1." / "1)" / "#1" in typed text.
  if (cells.length > 1 && /^#?\d{1,3}\.?$/.test(cells[0])) cells = cells.slice(1);
  cells[0] = cells[0].replace(/^#?\d{1,3}\s*[.):-]\s+/, "").replace(/^#\d{1,3}\s+/, "");

  // Hash: a cell that is only a hash, or a hash token at either end of the text.
  let hash: Hash | null = null;
  cells = cells.filter((c) => {
    if (hash) return true;
    const h =
      /^(L|M|R|LT|RT|MID|LEFT|RIGHT|MIDDLE)$/i.test(c) && cells.length > 1 ? parseHash(c) : hashFromToken(c);
    if (h) {
      hash = h;
      return false;
    }
    return true;
  });

  // A script with a personnel column ("Boston", "Miami"): not part of the call. Told by its
  // header, or by a lone unknown word ahead of a formation the app knows.
  let personnel: string | undefined;
  if (
    cells.length >= 3 &&
    (opts.personnel || (classifyFormation(cells[0]) === "unknown" && classifyFormation(cells[1]) !== "unknown"))
  ) {
    personnel = cells[0];
    cells = cells.slice(1);
  }

  let body = cells.join(" ").replace(/\s+/g, " ").trim();
  let look: PlaysheetRep["look"] = null;
  const vs = body.split(VS);
  if (vs.length > 1) {
    body = vs[0].trim();
    const lookText = vs.slice(1).join(" ").trim();
    if (lookText) look = splitLook(lookText);
  }

  if (!hash) {
    const ends: [RegExp, (m: RegExpMatchArray) => string][] = [
      [/^(\(?[LMR]\)?\s*HASH|[LMR]H|\([LMR]\)|\[[LMR]\]|(?:LEFT|RIGHT|MIDDLE|MID)\s+HASH)\s+/i, (m) => m[1]],
      [/\s+(\(?[LMR]\)?\s*HASH|[LMR]H|\([LMR]\)|\[[LMR]\]|(?:LEFT|RIGHT|MIDDLE|MID)\s+HASH)$/i, (m) => m[1]],
    ];
    for (const [re, pick] of ends) {
      const m = body.match(re);
      const h = m ? hashFromToken(pick(m)) : null;
      if (m && h) {
        hash = h;
        body = body.replace(re, "").trim();
        break;
      }
    }
  }

  if (!body) return null;
  // With separate cells, the first one left is the formation column.
  const formationCell = cells.length > 1 ? cells[0].split(VS)[0].trim() : "";
  return { call: body, formation: formationCell || body, ...(personnel ? { personnel } : {}), hash, look, line };
}

/**
 * A script copied out of a document sometimes arrives with every cell on its own
 * line: a rep number, then the personnel, formation and play, then the next number.
 * This puts each rep back on one tab-separated line (the same shape Excel and Sheets
 * paste), so one rep stays one line. Anything else comes back unchanged.
 */
export function normalizePlaysheetPaste(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // One cell per line: nearly no tabs, and several lines that are only a number.
  if (lines.length < 6 || lines.filter((l) => l.includes("\t")).length > lines.length / 4) return text;
  const body = lines.filter((l) => !HEADER_WORD.test(l) && !/practice\s+scripts?\s*$/i.test(l));
  const at = body.map((l, i) => (/^\d{1,3}$/.test(l) ? i : -1)).filter((i) => i >= 0);
  if (at.length < 2) return text;
  // Every rep has the same number of cells between one number and the next.
  const cellCount = at[1] - at[0] - 1;
  if (cellCount < 2 || cellCount > 4 || at[0] !== 0) return text;
  if (!at.every((start, k) => (k < at.length - 1 ? at[k + 1] - start : body.length - start) === cellCount + 1)) {
    return text;
  }
  const rows = at.map((start) => body.slice(start, start + cellCount + 1).join("\t"));
  // Three cells per rep read as personnel, formation, play; say so with a header row.
  return [...(cellCount === 3 ? ["NUMBER\tPERSONNEL\tFORMATION\tPLAY"] : []), ...rows].join("\n");
}

/** Every rep in a period's text, in order. */
export function parsePlaysheet(text: string): PlaysheetRep[] {
  const personnel = /(^|\t)\s*personnel\s*(\t|$)/im.test(text);
  return text
    .split(/\r?\n/)
    .map((l, i) => parsePlaysheetLine(l, i, { personnel }))
    .filter((r): r is PlaysheetRep => r !== null);
}

/**
 * One of our own plays (from the saved playbook) as a playsheet line, the way
 * the staff writes it: formation, then its strength side when the name doesn't
 * carry one, then the call ("TRIPS RT 836", "DEUCES LT IZ").
 */
export function playbookCallLine(card: Pick<HudlPlayCard, "formation" | "playCall" | "offStrength">): string {
  const formation = card.formation.trim();
  const side = parseSide(` ${formation} `) ? null : parseSideTag(card.offStrength);
  const tag = side === "left" ? "LT" : side === "right" ? "RT" : "";
  return [formation, tag, card.playCall.trim()]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/** First word of a call, the key for the staff's own formation names. */
export function aliasKey(call: string): string {
  return (
    call
      .trim()
      .split(/\s+/)[0]
      ?.toUpperCase()
      .replace(/[^A-Z0-9-]/g, "") ?? ""
  );
}

/** The shape a call draws as: the classifier first, then the staff's own names. */
export function repFormationKey(
  rep: Pick<PlaysheetRep, "formation" | "call">,
  aliases: Record<string, FormationKey>,
): FormationKey {
  const classified = classifyFormation(rep.formation);
  if (classified !== "unknown") return classified;
  const fromCall = classifyFormation(rep.call);
  if (fromCall !== "unknown") return fromCall;
  return aliases[aliasKey(rep.call)] ?? "unknown";
}

/** The formation family a rep names ("Twins Rt" → twins), else the family of the shape it draws as. */
export function repFamily(
  rep: Pick<PlaysheetRep, "formation" | "call">,
  aliases: Record<string, FormationKey>,
): FormationFamily {
  return formationFamily(rep.formation, repFormationKey(rep, aliases));
}

/* -------------------------------------------------------------------------- */
/*                               Opponent looks                               */
/* -------------------------------------------------------------------------- */

export function lookKey(front: string, coverage: string): string {
  const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");
  return `${norm(front)}|${norm(coverage)}`;
}

export function lookLabel(look: Pick<ScoutLook, "front" | "coverage">): string {
  return [look.front, look.coverage].filter(Boolean).join(" · ") || "—";
}

/**
 * The opponent's defensive looks from the loaded film, most common first. When
 * the breakdown has an ODK column, only their defense's snaps (ODK = D) count;
 * otherwise every tagged front does, like the Scout D cards.
 */
const odk = (c: HudlPlayCard) => (c.raw?.ODK ?? "").trim().toUpperCase();

export function opponentLooks(cards: HudlPlayCard[]): ScoutLook[] {
  // Film of the scouted team says which plays it was on defense in (the rest show the other team's front).
  const filmed = cards.some((c) => c.scoutSide);
  const defensive = filmed ? cards.filter((c) => c.scoutSide === "defense") : cards.filter((c) => odk(c) === "D");
  const pool = (defensive.length || filmed ? defensive : cards).filter((c) => c.defFront.trim() || c.coverage.trim());
  const looks = new Map<string, ScoutLook>();
  for (const c of pool) {
    const key = lookKey(c.defFront, c.coverage);
    const look = looks.get(key) ?? {
      key,
      front: c.defFront.trim(),
      coverage: c.coverage.trim(),
      count: 0,
      vs: {},
      vsKind: {},
    };
    look.count += 1;
    const kind = repKind(c.playCall);
    // Against the exact formation the staff names (Twins, Aces, Duces...) and against the shape it draws as.
    const family = formationFamily(c.formation, c.formationKey);
    const buckets = new Set([c.formationKey, ...(family === "unknown" ? [] : [familyKey(family)])]);
    for (const bucket of buckets) {
      look.vs[bucket] = (look.vs[bucket] ?? 0) + 1;
      if (kind) look.vsKind[`${bucket}|${kind}`] = (look.vsKind[`${bucket}|${kind}`] ?? 0) + 1;
    }
    looks.set(key, look);
  }
  return [...looks.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** What a rep's look was matched on: the exact formation, the shape it draws as, or the opponent's overall mix. */
export type LookBasis = "formation" | "shape" | "overall";

/** A rep as `assignLooks` needs it. `family` is the formation family key (`"fam:twins"`), when the rep names one. */
export interface LookRep {
  formationKey: FormationKey;
  family?: string | null;
  look: PlaysheetRep["look"];
  kind?: RepKind | null;
}

/**
 * Picks a look for every rep that didn't have one written in. Reps are matched
 * to what the opponent showed against that same formation (Twins, not just Pro)
 * and kind of play when there's film of it, then that formation, then the shape
 * it draws as, then their overall tendencies, and spread in proportion (smooth
 * weighted round-robin), so a 60/40 defense gets 6 and 4 reps out of 10, mixed
 * in rather than bunched. Same input, same picks.
 */
export function assignLooks(
  reps: LookRep[],
  looks: ScoutLook[],
): ({ front: string; coverage: string; fromFilm: boolean; basis?: LookBasis } | null)[] {
  const state = new Map<string, Map<string, number>>();
  return reps.map((rep) => {
    if (rep.look) return { ...rep.look, fromFilm: false };
    if (looks.length === 0) return null;
    // Narrowest pool with enough film first: formation + kind of play, formation, shape + kind, shape, then everything.
    const tiers: { key: string; kind: boolean; basis: LookBasis }[] = [];
    if (rep.family) {
      if (rep.kind) tiers.push({ key: `${rep.family}|${rep.kind}`, kind: true, basis: "formation" });
      tiers.push({ key: rep.family, kind: false, basis: "formation" });
    }
    if (rep.formationKey !== "unknown") {
      if (rep.kind) tiers.push({ key: `${rep.formationKey}|${rep.kind}`, kind: true, basis: "shape" });
      tiers.push({ key: rep.formationKey, kind: false, basis: "shape" });
    }
    let candidates = looks;
    let weight = (l: ScoutLook) => l.count;
    let bucket = "*";
    let basis: LookBasis = "overall";
    for (const tier of tiers) {
      const field = tier.kind ? "vsKind" : "vs";
      const pool = looks.filter((l) => (l[field][tier.key] ?? 0) > 0);
      const total = pool.reduce((sum, l) => sum + (l[field][tier.key] ?? 0), 0);
      if (pool.length === 0 || (tier.kind && total < MIN_KIND_REPS)) continue;
      candidates = pool;
      weight = (l) => l[field][tier.key] ?? 0;
      bucket = tier.key;
      basis = tier.basis;
      break;
    }
    const current = state.get(bucket) ?? new Map<string, number>();
    state.set(bucket, current);
    const total = candidates.reduce((sum, l) => sum + weight(l), 0);
    let best = candidates[0];
    let bestScore = -Infinity;
    for (const l of candidates) {
      const score = (current.get(l.key) ?? 0) + weight(l);
      current.set(l.key, score);
      if (score > bestScore) {
        best = l;
        bestScore = score;
      }
    }
    current.set(best.key, (current.get(best.key) ?? 0) - total);
    return { front: best.front, coverage: best.coverage, fromFilm: true, basis };
  });
}

/* -------------------------------------------------------------------------- */
/*                                   Cards                                    */
/* -------------------------------------------------------------------------- */

/** The family key a rep's look is matched on, or null where its formation names none. */
export function familyOf(rep: Pick<PlaysheetRep, "formation" | "call">, aliases: Record<string, FormationKey>): string | null {
  const family = repFamily(rep, aliases);
  return family === "unknown" ? null : familyKey(family);
}

export const PLAYSHEET_SOURCE = "Playsheet";

export function isRepCard(card: Pick<HudlPlayCard, "id">): boolean {
  return card.id.startsWith("rep-");
}

/**
 * Scout D cards for one of our offense's periods: each line of the playsheet,
 * in order, drawn as our formation against the look picked for it.
 */
export function periodRepCards(
  period: PracticePeriod,
  scriptCards: HudlPlayCard[],
  aliases: Record<string, FormationKey>,
): HudlPlayCard[] {
  const reps = parsePlaysheet(period.text).map((rep) => ({
    ...rep,
    formationKey: repFormationKey(rep, aliases),
    family: familyOf(rep, aliases),
    kind: repKind(rep.call),
  }));
  const picks = assignLooks(reps, opponentLooks(scriptCards));
  return reps.map((rep, i) => {
    const look = picks[i];
    const card = deriveCard({
      id: `rep-${period.id}-${rep.line}`,
      playNumber: i + 1,
      rowIndex: i,
      down: null,
      distance: null,
      isGoalToGo: false,
      yardLine: null,
      yardLineLabel: "",
      hash: rep.hash,
      formation: rep.call,
      offStrength: "",
      playCall: rep.call,
      playType: "",
      playDir: "",
      defFront: look?.front ?? "",
      coverage: look?.coverage ?? "",
      result: "",
      notes: [rep.personnel ? `Personnel: ${rep.personnel}.` : "", look && !look.fromFilm ? "Look from the playsheet." : ""]
        .filter(Boolean)
        .join(" "),
      source: PLAYSHEET_SOURCE,
      raw: {},
    });
    // The staff's own name for a formation the classifier doesn't know.
    const named = { ...card, formationName: rep.formation };
    return card.formationKey === "unknown" && rep.formationKey !== "unknown"
      ? { ...named, formationKey: rep.formationKey }
      : named;
  });
}

/**
 * Scout O cards for one of our defense's periods: the opponent's plays from
 * film, as usual for that period type, minus their defensive snaps (ODK = D)
 * when the breakdown tags them.
 */
export function periodScoutOCards(
  period: Pick<PracticePeriod, "kind">,
  scriptCards: HudlPlayCard[],
): HudlPlayCard[] {
  return scriptCards.filter((c) => odk(c) !== "D" && inPeriod(c, period.kind, "offense"));
}

/* -------------------------------------------------------------------------- */
/*                      Their defense vs the formations we run                 */
/* -------------------------------------------------------------------------- */

/** What the opponent's defense does against one formation in our script. */
export interface FormationDefense {
  family: FormationFamily;
  label: string;
  /** Reps of it in the script. */
  reps: number;
  /** Their snaps against this exact formation in the film. */
  filmSnaps: number;
  /** The fronts and coverages they showed, most common first (against the exact formation, else the shape it draws as). */
  looks: { look: ScoutLook; count: number }[];
  /** What `looks` are based on: this formation's film, the shape's film (this formation never appeared), or neither. */
  looksBasis: LookBasis | "none";
  /** Where their corners and safeties line up, and what that table is for. */
  secondary: DbAlignment | null;
  secondaryBasis: "formation" | "shape" | "coach" | "none";
  /** The shape it draws as, for the "using their Spread looks" wording. */
  shape: FormationKey;
}

/**
 * For every formation in our script (the offense periods of `periods`), what the opponent's defense does against it:
 * the fronts and coverages and where the corners and safeties stand, and whether that came from film of this very
 * formation, from the shape it draws as (no Aces film, so their Spread looks), or is a 4-3 default.
 */
export function defenseVsScript(
  periods: Pick<PracticePeriod, "side" | "text">[],
  looks: ScoutLook[],
  alignments: DbAlignments | undefined,
  aliases: Record<string, FormationKey>,
): FormationDefense[] {
  const by = new Map<FormationFamily, { reps: number; shape: FormationKey }>();
  for (const period of periods) {
    if (period.side !== "offense") continue;
    for (const rep of parsePlaysheet(period.text)) {
      const shape = repFormationKey(rep, aliases);
      const family = repFamily(rep, aliases);
      const entry = by.get(family) ?? { reps: 0, shape };
      entry.reps += 1;
      by.set(family, entry);
    }
  }
  const out: FormationDefense[] = [];
  for (const [family, { reps, shape }] of by) {
    const fam = family === "unknown" ? null : familyKey(family);
    const pick = (key: string | null) =>
      key
        ? looks
            .map((look) => ({ look, count: look.vs[key] ?? 0 }))
            .filter((x) => x.count > 0)
            .sort((a, b) => b.count - a.count || a.look.key.localeCompare(b.look.key))
        : [];
    const exact = pick(fam);
    const shaped = pick(shape === "unknown" ? null : shape);
    const overall = looks.map((look) => ({ look, count: look.count })).sort((a, b) => b.count - a.count);
    const [lookList, looksBasis]: [{ look: ScoutLook; count: number }[], FormationDefense["looksBasis"]] = exact.length
      ? [exact, "formation"]
      : shaped.length
        ? [shaped, "shape"]
        : overall.length
          ? [overall, "overall"]
          : [[], "none"];
    const table = alignments?.[fam ?? ""];
    const found = dbAlignmentFor(alignments, FAMILY_LABELS[family], shape);
    const secondaryBasis: FormationDefense["secondaryBasis"] = !found
      ? "none"
      : found.source === "coach"
        ? "coach"
        : table && found === table
          ? "formation"
          : "shape";
    out.push({
      family,
      label: FAMILY_LABELS[family],
      reps,
      filmSnaps: exact.reduce((sum, x) => sum + x.count, 0),
      looks: lookList,
      looksBasis,
      secondary: found ?? null,
      secondaryBasis,
      shape,
    });
  }
  return out.sort((a, b) => b.reps - a.reps || a.label.localeCompare(b.label));
}

/** Rewrites one line's "vs" look (or removes it, for Auto), keeping the rest of the line. */
export function setLineLook(
  text: string,
  line: number,
  look: { front: string; coverage: string } | null,
): string {
  const lines = text.split(/\r?\n/);
  if (line < 0 || line >= lines.length) return text;
  const base = lines[line].split(VS)[0].replace(/\s+$/, "");
  lines[line] = look ? `${base} vs ${lookLabel(look).replace(" · ", " ")}` : base;
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/*                                  Storage                                   */
/* -------------------------------------------------------------------------- */

export function loadPlan(): PracticePlan {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyPlan();
    const plan = JSON.parse(raw) as Partial<PracticePlan>;
    if (!Array.isArray(plan.days) || plan.days.length === 0) return emptyPlan();
    return {
      days: plan.days.map((d) => ({
        id: d.id || newId("d"),
        name: d.name ?? "Day",
        periods: (d.periods ?? []).map((p, i) => ({
          id: p.id || newId("p"),
          name: p.name ?? `Period ${i + 1}`,
          kind: p.kind === "team" ? "team" : "7v7",
          side: p.side === "defense" ? "defense" : "offense",
          text: p.text ?? "",
        })),
      })),
      formationAliases: plan.formationAliases ?? {},
    };
  } catch {
    return emptyPlan();
  }
}

export function savePlan(plan: PracticePlan): PracticePlan {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
    notifyLocalChange("practice");
  } catch {
    // Private mode or storage full: the plan lasts until the tab closes.
  }
  return plan;
}

import Papa from "papaparse";
import type { DefensiveAlignment } from "./defensiveAligner";
import type { DbAlignment } from "./secondary";
import type { CellValue } from "exceljs";

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

export type Hash = "L" | "M" | "R";
export type Side = "left" | "right";

export type FormationKey =
  | "spread"
  | "trips"
  | "i-form"
  | "double-eagle"
  | "pro"
  | "split-pro"
  | "unknown";

export type FrontKey = "4-3" | "3-4" | "5-2" | "bear" | "unknown";

export type PlayConcept =
  | "inside-zone"
  | "outside-zone"
  | "power"
  | "sweep"
  | "qb-run"
  | "verticals"
  | "slant"
  | "screen"
  | "boot"
  | "dropback"
  | "unknown";

/** One parsed Hudl row, cleaned up and ready to draw as a scout card. */
export interface HudlPlayCard {
  /** Stable id for React keys: `play-<playNumber>-<rowIndex>`. */
  id: string;
  /** Hudl's PLAY # when present and numeric, otherwise the 1-based row number. */
  playNumber: number;
  /** 0-based index of the data row in the CSV (header excluded). */
  rowIndex: number;

  down: number | null;
  /** Yards to go. `null` for goal-to-go or missing. */
  distance: number | null;
  isGoalToGo: boolean;
  /** Display label, e.g. "3rd & 6", "1st & G", or "—" when unknown. */
  downDistance: string;

  /** Signed Hudl yard line (-35 = own 35, +20 = opponent 20). */
  yardLine: number | null;
  /** Display label as written in the CSV ("-35", "+20", "50"). */
  yardLineLabel: string;
  hash: Hash | null;

  /** Raw OFF FORM text, trimmed ("TRIPS RT"). */
  formation: string;
  formationKey: FormationKey;
  /** Side the formation's strength is set to. Defaults to right. */
  formationSide: Side;

  /** Raw OFF PLAY / PLAY CALL text ("IZ RT"). */
  playCall: string;
  /** Hudl PLAY TYPE when it is a separate column (usually "Run" / "Pass"). */
  playType: string;
  concept: PlayConcept;
  /** Direction the play or primary route goes. */
  playDirection: Side;

  /** Raw DEF FRONT text ("4-3 OVER"). */
  defFront: string;
  frontKey: FrontKey;

  /** Hudl RESULT / GN/LS text ("Gain 6"), when the file has it. */
  result: string;

  /** Hudl COVERAGE text ("6 - DOUBLE FIRE"), shown on scout defense cards. */
  coverage: string;

  /** Raw OFF STR tag (L / R / BAL). Drives `formationSide` when set. */
  offStrength: string;
  /** Raw PLAY DIR tag (L / R / N). Drives `playDirection` when set. */
  playDir: string;
  /** Coach's note added in the app ("Z cracks the S"), shown on the card. */
  notes: string;
  /** Film (file name) the play came from. */
  source: string;
  /** True once a coach has changed the play in the app. */
  edited?: boolean;
  /**
   * Scout defense: defenders a coach dragged to where they lined up on film,
   * by defender id ("FS1", "C2"), in un-flipped card coordinates.
   */
  defenseOverrides?: Record<string, { x: number; y: number }>;
  /**
   * Scout defense: this play's safety depth and how the slots are played
   * (src/lib/defensiveAligner.ts), set from the Scout D toolbar or the AI card.
   */
  defenseAlignment?: DefensiveAlignment;
  /** A coach's own text for assignment-table boxes, by key ("PST", "Y", "FRONT"). */
  assignmentNotes?: Record<string, string>;
  /**
   * A coach's route for a letter ("X", "F"), overriding the play call: a route
   * kind ("fade", "wheel"), "stalk", "protect", or "none"; plus an optional tag
   * written at the arrow tip ("HOT").
   */
  routeOverrides?: Record<string, RouteOverride>;
  /** Pencil drawings on the card, per scout unit, in card (SVG) coordinates. */
  drawings?: Partial<Record<"offense" | "defense", InkStroke[]>>;
  /**
   * What the AI import review (src/lib/importReview.ts) read from text the
   * classifiers couldn't place: used only where the rules come up empty, so
   * anything the text itself says always wins. Marked "AI" in the play list.
   */
  aiHints?: AiHints;
  /** True once the AI import review has looked at this play (so it's never sent twice). */
  aiReviewed?: boolean;
  /**
   * The opponent's secondary vs this card's formation (src/lib/secondary.ts),
   * attached when the card is shown from the script's per-formation table,
   * never saved on the card itself.
   */
  secondary?: DbAlignment;

  /** Every column of the original row, keyed by the normalized header. */
  raw: Record<string, string>;
}

/** The AI import review's reading of a play's unrecognized tags (see `aiHints`). */
export interface AiHints {
  formationKey?: Exclude<FormationKey, "unknown">;
  side?: Side;
  frontKey?: Exclude<FrontKey, "unknown">;
  playType?: "Run" | "Pass";
  /** The AI built the play's route concept (per-letter `routeOverrides` with `source: "ai"`). */
  routes?: boolean;
}

/** A coach's route assignment for one letter (see `routeOverrides`). */
export interface RouteOverride {
  /** Route kind from the tree or off it ("slant", "wheel"), or "stalk" / "protect" / "none". */
  route?: string;
  /** Short tag at the arrow tip and in the table ("HOT", "SIGHT", "READ 1"). */
  tag?: string;
  /**
   * A literal route shape instead of a named kind: waypoints in the diagram's
   * own units, each relative to the player's own position (a delta, not an
   * absolute point), so it survives hash/formation changes the same way a
   * named route does. Set by video detection; a coach can drag its points to
   * correct it (see `source`). Takes priority over `route` when both are set.
   */
  path?: [number, number][];
  /**
   * Where this override came from: a coach typing it in, AI video detection,
   * or a card generated from a typed play call. Video and AI paths get
   * draggable break points on the card.
   */
  source?: "coach" | "video" | "ai";
}

/** One pencil stroke on a card. */
export interface InkStroke {
  color: string;
  width: number;
  /** [x, y] points in the card's SVG coordinates (viewBox 500 × 300). */
  points: [number, number][];
}

/** The logical fields the parser maps Hudl columns onto. */
export type HudlField =
  | "playNumber"
  | "down"
  | "distance"
  | "yardLine"
  | "hash"
  | "formation"
  | "playCall"
  | "playType"
  | "defFront"
  | "result"
  | "coverage"
  | "offStrength"
  | "playDir"
  | "odk";

export interface HudlParseResult {
  cards: HudlPlayCard[];
  /** Which CSV header was used for each field. */
  columns: Partial<Record<HudlField, string>>;
  /** Core fields with no matching column in the file. */
  missingColumns: HudlField[];
  warnings: string[];
  /** Data rows read from the file, before empty/special-teams rows are dropped. */
  rowCount: number;
  /**
   * Set when the upload isn't a text CSV at all (a Numbers or Excel file with a
   * .csv name). The app shows export steps instead of "No plays found".
   */
  unsupportedFile?: UnsupportedFile;
}

export type UnsupportedFileKind = "numbers" | "excel" | "binary";

export interface UnsupportedFile {
  kind: UnsupportedFileKind;
  /** Plain-language explanation plus how to export a real CSV. */
  message: string;
}

/* -------------------------------------------------------------------------- */
/*                              Column mapping                                */
/* -------------------------------------------------------------------------- */

/**
 * Header variants per field, in priority order. Headers are compared after
 * `normalizeHeader`, so case, extra spaces, and dots/underscores don't matter.
 */
export const COLUMN_ALIASES: Record<HudlField, string[]> = {
  playNumber: ["PLAY #", "PLAY#", "PLAY NO", "PLAY NUMBER", "PLAY"],
  down: ["DN", "DOWN"],
  distance: ["DIST", "DISTANCE", "YDS TO GO", "TO GO"],
  yardLine: ["YARD LN", "YARD LINE", "YARDLINE", "YD LN", "BALL ON", "FIELD POS", "YARD"],
  hash: ["HASH", "HASH MARK", "HASH MARKS", "H"],
  formation: ["OFF FORM", "OFF FORMATION", "FORMATION", "OFF FORM NAME", "FORM"],
  // A bare "PLAY" column is the play number when it holds numbers and the play
  // call when it holds names; `resolveBarePlayColumn` decides from the data.
  playCall: ["OFF PLAY", "PLAY CALL", "OFF PLAY CALL", "PLAY TYPE"],
  playType: ["PLAY TYPE", "PLAY TYP", "RUN/PASS"],
  defFront: ["DEF FRONT", "FRONT", "DEF ALIGN", "DEF FORM", "DEF FORMATION"],
  result: ["RESULT", "PLAY RESULT", "GN/LS", "GAIN/LOSS"],
  coverage: ["COVERAGE", "COV", "DEF COVERAGE", "DEF COV", "COVERAGES"],
  offStrength: ["OFF STR", "OFF STRENGTH", "STRENGTH", "STR"],
  playDir: ["PLAY DIR", "PLAY DIRECTION", "DIR", "DIRECTION"],
  odk: ["ODK"],
};

/** Fields a scout card needs; a missing one produces a `missingColumns` entry. */
const CORE_FIELDS: HudlField[] = [
  "down",
  "distance",
  "hash",
  "formation",
  "playCall",
  "defFront",
];

const KNOWN_HEADERS = new Set(Object.values(COLUMN_ALIASES).flat());

export function normalizeHeader(header: string): string {
  return header
    .replace(/^﻿/, "")
    .toUpperCase()
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pattern fallbacks for header names that aren't in `COLUMN_ALIASES`, such as
 * spelled-out exports ("Offensive Formation", "Defensive Front", "Yards To
 * Go"). Tested against normalized headers, after the exact aliases.
 */
const HEADER_PATTERNS: Record<HudlField, RegExp> = {
  playNumber: /^(#|NO|PLAY ?(#|NO|NUM|NUMBER|ID))$/,
  down: /^(DN|DWN|DOWNS?)$/,
  distance: /^(DIST|DISTANCE|YTG|(YDS|YARDS) TO GO|TO GO)$/,
  yardLine: /\b(YARD|YD)S? ?(LN|LINE)\b|\bBALL ON\b|\bFIELD POS/,
  hash: /\bHASH/,
  formation: /^(?!.*\b(DEF|DEFENSIVE|DEFENSE|D)\b).*\bFORM(ATION)?S?\b/,
  playCall: /\b(OFF|OFFENSIVE|OFFENSE|O) ?PLAY\b|\bPLAY ?(CALL|NAME)\b/,
  playType: /^PLAY TYPE$|\bRUN ?\/? ?PASS\b/,
  defFront: /\b(DEF|DEFENSIVE|DEFENSE|D) ?(FRONT|FRONTS|ALIGN|ALIGNMENT|FORM|FORMATION)\b|^FRONTS?$/,
  result: /\bRESULTS?\b|^(GN|GAIN) ?\/? ?(LS|LOSS)$/,
  coverage: /\bCOV(ERAGE)?S?\b|\bSHELL\b/,
  offStrength: /^(OFF |OFFENSIVE |FORM )?STR(ENGTH)?$/,
  playDir: /^(PLAY |RUN )?DIR(ECTION)?$/,
  odk: /^ODK$/,
};

/** Whether a (raw or normalized) header cell looks like a Hudl column. */
export function isHudlHeader(header: string): boolean {
  const h = normalizeHeader(header);
  return (
    KNOWN_HEADERS.has(h) || (Object.values(HEADER_PATTERNS) as RegExp[]).some((re) => re.test(h))
  );
}

/**
 * Picks the CSV header to use for every field: exact aliases first (in
 * priority order), then `HEADER_PATTERNS` for anything still unmapped.
 */
export function mapColumns(headers: string[]): Partial<Record<HudlField, string>> {
  const normalized = headers.map(normalizeHeader);
  const available = new Set(normalized);
  const columns: Partial<Record<HudlField, string>> = {};
  const fields = Object.keys(COLUMN_ALIASES) as HudlField[];
  for (const field of fields) {
    const match = COLUMN_ALIASES[field].find((alias) => available.has(alias));
    if (match) columns[field] = match;
  }
  const claimed = new Set(Object.values(columns));
  for (const field of fields) {
    if (columns[field]) continue;
    const match = normalized.find((h) => !claimed.has(h) && HEADER_PATTERNS[field].test(h));
    if (match) {
      columns[field] = match;
      claimed.add(match);
    }
  }
  // PLAY TYPE is only the play call when nothing better exists; if it is used
  // as the play call, don't also report it as the run/pass type.
  if (columns.playCall && columns.playCall === columns.playType) {
    delete columns.playType;
  }
  return columns;
}

/* -------------------------------------------------------------------------- */
/*                            Value normalization                             */
/* -------------------------------------------------------------------------- */

const ORDINALS = ["", "1st", "2nd", "3rd", "4th"];

export function parseDown(value: string): number | null {
  const match = value.trim().match(/^([1-4])/);
  return match ? Number(match[1]) : null;
}

export function parseDistance(value: string): { distance: number | null; isGoalToGo: boolean } {
  const v = value.trim().toUpperCase();
  if (v === "G" || v === "GL" || v.startsWith("GOAL")) return { distance: null, isGoalToGo: true };
  const match = v.match(/^\d+(\.\d+)?/);
  return { distance: match ? Math.round(Number(match[0])) : null, isGoalToGo: false };
}

export function formatDownDistance(
  down: number | null,
  distance: number | null,
  isGoalToGo = false,
): string {
  if (down == null) return "—";
  const togo = isGoalToGo ? "G" : distance == null ? "?" : String(distance);
  return `${ORDINALS[down]} & ${togo}`;
}

export function parseHash(value: string): Hash | null {
  const v = value.trim().toUpperCase();
  if (!v) return null;
  if (/^(L|LT|LEFT|LH)\b/.test(v)) return "L";
  if (/^(R|RT|RIGHT|RH)\b/.test(v)) return "R";
  if (/^(M|MID|MIDDLE|C|CTR|CENTER|CENTRE)\b/.test(v)) return "M";
  return null;
}

/**
 * Hudl yard lines are signed from the offense's view: "-35" / "Own 35" is the
 * offense's own 35, "+20" / "Opp 20" is the opponent's 20. "50" / "Mid" is midfield.
 */
export function parseYardLine(value: string): number | null {
  const v = value.trim().toUpperCase();
  if (/^(MID|MIDFIELD)$/.test(v)) return 50;
  const match = v.match(/^(OPP|OWN|O|[+-])?\s*(\d{1,2})$/);
  if (!match) return null;
  const n = Number(match[2]);
  if (n > 50) return null;
  return match[1] === "-" || match[1] === "OWN" ? -n : n;
}

/** Word-boundary keyword test that treats hyphens and slashes as separators. */
function has(text: string, pattern: RegExp): boolean {
  const words = text.toUpperCase().replace(/[-/_.,]/g, " ").replace(/\s+/g, " ").trim();
  return pattern.test(` ${words} `);
}

export function classifyFormation(formation: string): FormationKey {
  if (!formation.trim()) return "unknown";
  if (has(formation, /\s(DOUBLE|DBL|DBLE)\s*EAGLE\s|\sEAGLE\s/)) return "double-eagle";
  if (has(formation, /\s(TRIPS|TREY|TRIO|TRIPLE|BUNCH)\s/)) return "trips";
  if (has(formation, /\s(I|IFORM|I FORM|POWER I|TIGHT I|SLOT I|MAX I)\s/)) return "i-form";
  // Pro is I-backs (F behind Q, H behind F); split backs only when the tag says so.
  if (has(formation, /\s(SPLIT|SPLITS|SPLIT BACK|SPLIT BACKS|SPLITBACK|SPLITBACKS|SPLIT PRO|PRO SPLIT)\s/)) {
    return "split-pro";
  }
  if (has(formation, /\s(PRO|WEAK|STRONG|TWINS)\s/)) return "pro";
  if (has(formation, /\s(SPREAD|DOUBLES|DBLS|2X2|GUN|SHOTGUN|ACE|ACES|DEUCE|DEUCES|DUCES|EMPTY|DOUBLE)\s/)) return "spread";
  return "unknown";
}

export function classifyFront(front: string): FrontKey {
  if (!front.trim()) return "unknown";
  const f = front.toUpperCase().replace(/\s+/g, " ");
  if (has(f, /\s(BEAR|46|DOUBLE EAGLE|DBL EAGLE)\s/)) return "bear";
  if (/\b5[\s-]?[23]\b|\bOKIE\b|\bOKLAHOMA\b|\b50\b/.test(f)) return "5-2";
  if (/\b3[\s-]?[34](?:[\s-]?5)?\b|\bTITE\b|\bMINT\b|\bSTACK\b|\bODD\b/.test(f)) return "3-4";
  if (/\b4[\s-]?[34](?:[\s-]?5)?\b|\b4[\s-]?2[\s-]?5\b|\bOVER\b|\bUNDER\b|\bEVEN\b/.test(f)) return "4-3";
  return "unknown";
}

export function classifyConcept(playCall: string, playType = ""): PlayConcept {
  const p = playCall;
  if (p.trim()) {
    if (has(p, /\s(BUBBLE|SCREEN|TUNNEL|SLIP|SWING|RB SCREEN|WR SCREEN|NOW)\s/)) return "screen";
    if (has(p, /\s(BOOT|BOOTLEG|NAKED|WAGGLE|SPRINT|ROLL|ROLLOUT|PA|PLAY ACTION)\s/)) return "boot";
    if (has(p, /\s(VERTS|VERT|VERTICAL|VERTICALS|4 VERTS|FOUR VERTS|GO|GOES|SEAM|SEAMS|FADE)\s/)) return "verticals";
    if (has(p, /\s(SLANT|SLANTS|QUICK|STICK|HITCH|SPACING)\s/)) return "slant";
    if (has(p, /\s(QB|Q)\s/) && has(p, /\s(ISO|DRAW|POWER|LEAD|RUN|SNEAK|COUNTER|G|TRAP|ZONE|KEEP|B)\s/)) {
      return "qb-run";
    }
    if (has(p, /\s(SWEEP|TOSS|PITCH|JET|FLY|BUCK SWEEP|REVERSE|OPTION|SPEED OPTION|SPEED)\s/)) return "sweep";
    if (has(p, /\s(OZ|OUTSIDE ZONE|STRETCH|WIDE ZONE|OUTSIDE)\s/)) return "outside-zone";
    if (has(p, /\s(POWER|COUNTER|TREY|GT|TRAP|ISO|LEAD|BELLY|DART|G)\s/)) return "power";
    if (has(p, /\s(SNEAK|QB DRAW|QB RUN|QB POWER|QB COUNTER|DRAW)\s/)) return "qb-run";
    if (has(p, /\s(IZ|INSIDE ZONE|ZONE|DIVE|MID ZONE|SPLIT ZONE|ZONE READ|RPO)\s/)) return "inside-zone";
    if (has(p, /\s(PASS|DROPBACK|DROP|SMASH|CURL|FLAT|FLOOD|MESH|SAIL|DIG|POST|CORNER|OUT|DAGGER|Y CROSS|CROSS|SHALLOW)\s/)) return "dropback";
    if (has(p, /\sRUN\s/)) return "inside-zone";
  }
  const t = playType.trim().toUpperCase();
  if (t.startsWith("RUN")) return "inside-zone";
  if (t.startsWith("PASS")) return "dropback";
  return "unknown";
}

/**
 * Concept from the play call / play type. A blank play call with PLAY DIR "N"
 * (no direction) is a pass: Hudl staffs tag run direction, not pass direction.
 */
export function inferConcept(playCall: string, playType: string, playDir: string): PlayConcept {
  const concept = classifyConcept(playCall, playType);
  if (concept === "unknown" && !playCall.trim() && /^(N|NONE|NO DIR|NA)$/i.test(playDir.trim())) {
    return "dropback";
  }
  return concept;
}

/** Reads a dedicated direction cell (Hudl OFF STR / PLAY DIR): L, R, LT, Right… BAL/N → null. */
export function parseSideTag(value: string): Side | null {
  const v = value.trim().toUpperCase();
  if (/^(L|LT|LFT|LEFT)$/.test(v)) return "left";
  if (/^(R|RT|RGT|RIGHT)$/.test(v)) return "right";
  return null;
}

/** Reads a left/right tag ("RT", "LEFT", trailing "R") out of free text. */
export function parseSide(text: string): Side | null {
  if (has(text, /\s(LT|LEFT|LFT|LIZ|LOU|L)\s/)) return "left";
  if (has(text, /\s(RT|RIGHT|RGT|RIP|RAY|R)\s/)) return "right";
  return null;
}

/* -------------------------------------------------------------------------- */
/*                                   Parser                                   */
/* -------------------------------------------------------------------------- */

/** One data row, keyed by normalized header name. Every value is trimmed text. */
export type CsvRow = Record<string, string>;

function cell(row: CsvRow, column: string | undefined): string {
  return column ? (row[column] ?? "").trim() : "";
}

/**
 * Pre-processes a raw upload before PapaParse sees it:
 * - newlines: `\r\n` and `\r` become `\n`
 * - curly double quotes (“ ” „ ‟ ″) become straight `"`
 * - curly single quotes (‘ ’ ‚ ‛ ′) become straight `'`
 * - non-breaking spaces become normal spaces
 * - BOMs, zero-width characters, and other non-printable control characters
 *   are stripped (tabs and newlines are kept: tab is a valid delimiter)
 * Straightening quotes can leave a cell like `"Hot" Slant` with unbalanced
 * quoting; `parseHudlCsvText` repairs that with `repairCsvLine` when needed.
 */
export function sanitizeCsvInput(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[   ]/g, " ")
    .replace(/[﻿​-‍⁠\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
}

function quoteField(field: string, delimiter: string): string {
  return /["\r\n]/.test(field) || field.includes(delimiter)
    ? `"${field.replace(/"/g, '""')}"`
    : field;
}

/**
 * Re-quotes one CSV line leniently, then writes it back as valid CSV:
 * - A cell that starts with `"` ends at the first `"` that is followed by the
 *   delimiter or the end of the line. Quotes inside it are kept literally, so
 *   `"Slant "Hot" Rt"` reads as `Slant "Hot" Rt`.
 * - If no such closing quote exists (`"Hot" Slant Rt`), the opening quote was
 *   just text: the cell runs to the next delimiter like an unquoted one.
 * Works on single lines, so it's only used on files that failed to parse,
 * where a multi-line quoted cell is already lost anyway.
 */
export function repairCsvLine(line: string, delimiter: string): string {
  const fields: string[] = [];
  let i = 0;
  for (;;) {
    if (line[i] === '"') {
      let close = -1;
      for (let j = i + 1; j < line.length; j++) {
        if (line[j] !== '"') continue;
        if (line[j + 1] === '"') {
          j++; // escaped "" inside the cell
          continue;
        }
        if (j + 1 === line.length || line.startsWith(delimiter, j + 1)) {
          close = j;
          break;
        }
      }
      if (close !== -1) {
        fields.push(line.slice(i + 1, close).replace(/""/g, '"'));
        if (close + 1 === line.length) break;
        i = close + 1 + delimiter.length;
        continue;
      }
    }
    const next = line.indexOf(delimiter, i);
    fields.push(line.slice(i, next === -1 ? line.length : next));
    if (next === -1) break;
    i = next + delimiter.length;
  }
  return fields.map((f) => quoteField(f, delimiter)).join(delimiter);
}

/** Parses sanitized text into raw rows (no header handling, no typing). */
function parseRawRows(text: string) {
  return Papa.parse<string[]>(text, {
    header: false,
    // Auto-detect comma, tab, semicolon, or pipe (European Excel saves with ";").
    delimiter: "",
    quoteChar: '"',
    escapeChar: '"',
    skipEmptyLines: "greedy",
  });
}

/** How many rows from the top to search for the header row. */
const HEADER_SEARCH_ROWS = 25;

/**
 * Index of the header row within the top `HEADER_SEARCH_ROWS` rows: the row
 * with the most Hudl-looking column names (`PLAY #`, `DN`, `OFF FORM`,
 * `OFF PLAY`, `FORMATION`, …), needing at least two. Picking the best row
 * (earliest on a tie) rather than the first match keeps a metadata line
 * like "Offensive formation report, defensive front" from winning.
 * Rows above it (titles, notes, `sep=,`, blanks) are ignored. -1 if none.
 */
export function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, HEADER_SEARCH_ROWS);
  let best = -1;
  let bestHits = 1;
  for (let i = 0; i < limit; i++) {
    const hits = rows[i].filter(isHudlHeader).length;
    if (hits > bestHits) {
      best = i;
      bestHits = hits;
    }
  }
  return best;
}

/** Normalized, unique header keys; blank headers become `COLUMN <n>`. */
function headerKeys(headerRow: string[]): string[] {
  const seen = new Map<string, number>();
  return headerRow.map((h, i) => {
    const key = normalizeHeader(h) || `COLUMN ${i + 1}`;
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count === 0 ? key : `${key} (${count + 1})`;
  });
}

/**
 * Maps a raw row onto header keys by index. Short rows (missing trailing
 * commas) read as blank cells; extra cells past the last header are ignored.
 */
export function rowToRecord(keys: string[], values: string[]): CsvRow {
  const record: CsvRow = {};
  keys.forEach((key, i) => {
    record[key] = (values[i] ?? "").trim();
  });
  return record;
}

/** The text a play is built from; everything else on a card is derived from it. */
export type PlaySource = Omit<
  HudlPlayCard,
  "downDistance" | "formationKey" | "formationSide" | "concept" | "playDirection" | "frontKey"
>;

/** Fills in the classified fields (formation type, sides, concept, front) from the text. */
export function deriveCard(base: PlaySource): HudlPlayCard {
  // Older saved scripts predate some fields.
  const formation = base.formation ?? "";
  const playCall = base.playCall ?? "";
  const playType = base.playType ?? "";
  const offStrength = base.offStrength ?? "";
  const playDir = base.playDir ?? "";
  const defFront = base.defFront ?? "";
  const hints = base.aiHints ?? {};
  // Explicit Hudl OFF STR / PLAY DIR tags win over side tags inside the text,
  // and the text wins over the AI review's reading.
  const formationSide = parseSideTag(offStrength) ?? parseSide(formation) ?? hints.side ?? "right";
  const classifiedFormation = classifyFormation(formation);
  const classifiedFront = classifyFront(defFront);
  return {
    ...base,
    formation,
    playCall,
    playType,
    offStrength,
    playDir,
    defFront,
    coverage: base.coverage ?? "",
    result: base.result ?? "",
    notes: base.notes ?? "",
    source: base.source ?? "",
    downDistance: formatDownDistance(base.down, base.distance, base.isGoalToGo),
    formationKey:
      classifiedFormation === "unknown" && formation.trim() ? (hints.formationKey ?? "unknown") : classifiedFormation,
    formationSide,
    concept: inferConcept(playCall, playType || hints.playType || "", playDir),
    playDirection: parseSideTag(playDir) ?? parseSide(playCall) ?? formationSide,
    frontKey: classifiedFront === "unknown" && defFront.trim() ? (hints.frontKey ?? "unknown") : classifiedFront,
  };
}

/** Fields a coach can change from the app's Edit dialog. */
export type CardEdits = Partial<
  Pick<
    HudlPlayCard,
    | "formation"
    | "offStrength"
    | "playCall"
    | "playDir"
    | "defFront"
    | "coverage"
    | "hash"
    | "notes"
    | "routeOverrides"
  >
>;

/** Applies edits and re-derives the card, so it draws exactly as a Hudl row would. */
export function updateCard(card: HudlPlayCard, edits: CardEdits): HudlPlayCard {
  // A coach retyping a field drops the AI's reading of the old text.
  let aiHints = card.aiHints;
  if (aiHints) {
    const changed = (k: keyof CardEdits) => edits[k] !== undefined && edits[k] !== card[k];
    aiHints = { ...aiHints };
    if (changed("formation")) delete aiHints.formationKey;
    if (changed("formation") || changed("offStrength")) delete aiHints.side;
    if (changed("defFront")) delete aiHints.frontKey;
    if (changed("playCall")) delete aiHints.playType;
    if (changed("playCall")) delete aiHints.routes;
    if (Object.keys(aiHints).length === 0) aiHints = undefined;
  }
  // A new play call drops the AI's routes for the old one (a coach's own stay).
  let routeOverrides = edits.routeOverrides ?? card.routeOverrides;
  if (edits.playCall !== undefined && edits.playCall !== card.playCall && routeOverrides) {
    routeOverrides = Object.fromEntries(
      Object.entries(routeOverrides).filter(([, o]) => !(o.source === "ai" && !o.path?.length)),
    );
  }
  return deriveCard({ ...card, ...edits, routeOverrides, aiHints, edited: true });
}

/** Turns one keyed CSV row into a card. Exposed for tests. */
export function rowToCard(
  row: CsvRow,
  rowIndex: number,
  columns: Partial<Record<HudlField, string>>,
  source = "",
): HudlPlayCard {
  const playNumberRaw = cell(row, columns.playNumber);
  const parsedPlayNumber = Number.parseInt(playNumberRaw, 10);
  const playNumber = Number.isFinite(parsedPlayNumber) ? parsedPlayNumber : rowIndex + 1;
  const down = parseDown(cell(row, columns.down));
  const { distance, isGoalToGo } = parseDistance(cell(row, columns.distance));
  const yardLineLabel = cell(row, columns.yardLine);

  return deriveCard({
    id: `play-${playNumber}-${rowIndex}`,
    playNumber,
    rowIndex,
    down,
    distance,
    isGoalToGo,
    yardLine: parseYardLine(yardLineLabel),
    yardLineLabel,
    hash: parseHash(cell(row, columns.hash)),
    formation: cell(row, columns.formation),
    offStrength: cell(row, columns.offStrength),
    playCall: cell(row, columns.playCall),
    playType: cell(row, columns.playType),
    playDir: cell(row, columns.playDir),
    defFront: cell(row, columns.defFront),
    result: cell(row, columns.result),
    coverage: cell(row, columns.coverage),
    notes: "",
    source,
    raw: row,
  });
}

/**
 * Combines plays from several films into one script. Each play is tagged with
 * its film and gets an id that can't collide across files (play #1 exists in
 * every game).
 */
export function combineFilms(films: { name: string; cards: HudlPlayCard[] }[]): HudlPlayCard[] {
  const stamp = Date.now().toString(36);
  return films.flatMap((film, f) =>
    film.cards.map((card) => ({ ...card, source: film.name, id: `${stamp}-f${f}-${card.id}` })),
  );
}

/**
 * A column headed just "PLAY" is ambiguous: some staffs number plays in it,
 * others type the play call. Mostly-numeric values keep it as the play number;
 * otherwise it becomes the play call (unless a better play-call column exists).
 */
export function resolveBarePlayColumn(
  columns: Partial<Record<HudlField, string>>,
  keys: string[],
  dataRows: string[][],
): Partial<Record<HudlField, string>> {
  if (columns.playNumber !== "PLAY") return columns;
  const index = keys.indexOf("PLAY");
  const values = dataRows.map((r) => (r[index] ?? "").trim()).filter(Boolean);
  const numeric = values.filter((v) => /^\d+$/.test(v)).length;
  if (values.length === 0 || numeric >= values.length / 2) return columns;
  const resolved = { ...columns };
  delete resolved.playNumber;
  if (!resolved.playCall) resolved.playCall = "PLAY";
  return resolved;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Recognizes uploads that aren't text CSV even though they're named .csv:
 * Apple Numbers and Excel .xlsx files are zip archives (they start with "PK"),
 * and old Excel .xls files start with the OLE signature. Returns null for text.
 */
export function detectUnsupportedFile(text: string): UnsupportedFile | null {
  const head = text.slice(0, 4096);
  if (head.startsWith("PK\u0003\u0004")) {
    if (text.includes("Index/Document.iwa") || text.includes("Index/Tables/")) {
      return {
        kind: "numbers",
        message:
          "This is an Apple Numbers file saved with a .csv name, not a real CSV. In Numbers, choose File → Export To → CSV…, then upload the exported file.",
      };
    }
    if (text.includes("xl/workbook") || text.includes("[Content_Types].xml")) {
      return {
        kind: "excel",
        message:
          "This is an Excel workbook (.xlsx) with a .csv name, not a real CSV. In Excel, choose File → Save As → CSV UTF-8 (Comma delimited), then upload that file.",
      };
    }
  }
  // Zip archives and files full of control bytes (.xls, PDFs…) aren't text.
  // NUL is left out on purpose: UTF-16 text decodes with NULs and parses fine.
  const binary =
    head.startsWith("PK\u0003\u0004") ||
    (head.match(/[\u0001-\u0008\u000E-\u001A]/g)?.length ?? 0) > 20;
  if (binary) {
    return {
      kind: "binary",
      message:
        "This file isn't a text CSV (it looks like a spreadsheet or other binary file). Export the breakdown as CSV from Hudl, Excel, Numbers, or Google Sheets and upload that.",
    };
  }
  return null;
}

/**
 * Parses Hudl breakdown CSV text synchronously:
 * sanitize → raw 2D rows → find the header row → map rows by column index.
 * Never throws; problems come back as `warnings` and valid rows always load.
 */
export function parseHudlCsvText(text: string): HudlParseResult {
  const unsupportedFile = detectUnsupportedFile(text);
  if (unsupportedFile) {
    return {
      cards: [],
      columns: {},
      missingColumns: [...CORE_FIELDS],
      warnings: [unsupportedFile.message],
      rowCount: 0,
      unsupportedFile,
    };
  }
  const sanitized = sanitizeCsvInput(text);
  let parsed = parseRawRows(sanitized);
  let repairedQuotes = false;

  // Stray or unbalanced quotes: PapaParse either warns (and keeps the row) or,
  // worse, swallows the rest of the file into one cell. Re-quote each line
  // leniently and parse again; keep whichever result has fewer quote errors.
  const quoteErrors = (p: typeof parsed) => p.errors.filter((e) => e.type === "Quotes").length;
  if (quoteErrors(parsed) > 0) {
    const delimiter = parsed.meta.delimiter || ",";
    const repaired = parseRawRows(
      sanitized
        .split("\n")
        .map((line) => repairCsvLine(line, delimiter))
        .join("\n"),
    );
    if (quoteErrors(repaired) < quoteErrors(parsed)) {
      parsed = repaired;
      repairedQuotes = true;
    }
  }

  const rows = parsed.data.filter((r) => Array.isArray(r));
  const found = findHeaderRow(rows);
  const headerIndex = Math.max(found, 0);
  const keys = headerKeys(rows[headerIndex] ?? []);
  const dataRows = rows.slice(headerIndex + 1);
  const columns = resolveBarePlayColumn(mapColumns(keys), keys, dataRows);

  const warnings: string[] = [];
  if (found > 0) {
    warnings.push(`Skipped ${plural(found, "line")} above the header row (title or notes).`);
  }
  if (repairedQuotes) {
    warnings.push("Fixed stray quote marks in the file. Double-check play names that use quotes.");
  }
  const remainingQuoteErrors = parsed.errors.filter((e) => e.type === "Quotes");
  for (const error of remainingQuoteErrors.slice(0, 3)) {
    const where = error.row != null ? ` (line ${error.row + 1})` : "";
    warnings.push(`${error.message}${where}`);
  }

  const missingColumns = CORE_FIELDS.filter((field) => !columns[field]);
  if (!columns.formation && !columns.playCall && !columns.defFront) {
    warnings.push("No formation, play, or front columns found. Is this a Hudl breakdown export?");
  }

  // Relaxed validation: a row is a play if ANY of these is filled in. Blank
  // fronts, play calls, hashes, etc. just show as "—" on the card.
  const identifyingColumns = [
    columns.playNumber,
    columns.down,
    columns.formation,
    columns.playCall,
    columns.playType,
    columns.result,
  ];
  const cards: HudlPlayCard[] = [];
  let blankRows = 0;
  let specialTeams = 0;
  let unreadable = 0;
  dataRows.forEach((values, rowIndex) => {
    try {
      const row = rowToRecord(keys, values);
      if (cell(row, columns.odk).toUpperCase() === "K") {
        specialTeams += 1;
        return;
      }
      if (identifyingColumns.every((c) => !cell(row, c))) {
        blankRows += 1;
        return;
      }
      cards.push(rowToCard(row, rowIndex, columns));
    } catch {
      unreadable += 1;
    }
  });

  if (unreadable > 0) {
    warnings.push(`Couldn't read ${plural(unreadable, "row")}; the rest loaded normally.`);
  }
  if (specialTeams > 0) {
    warnings.push(`Skipped ${plural(specialTeams, "special teams row")} (ODK = K).`);
  }
  if (blankRows > 0) {
    warnings.push(
      `Skipped ${plural(blankRows, "row")} with no play #, down, formation, play call, or result.`,
    );
  }

  return { cards, columns, missingColumns, warnings, rowCount: dataRows.length };
}

/**
 * Peeks at the first few KB rather than reading a whole (possibly large)
 * file as text, just to check for the zip signature a real `.xlsx` starts
 * with — the same check `detectUnsupportedFile` uses to recognize an Excel
 * workbook saved with a `.csv` name, reused here to actually parse it
 * instead of just explaining how to re-export it.
 */
async function looksLikeExcelWorkbook(blob: Blob): Promise<boolean> {
  const head = await blob.slice(0, 4096).text();
  return head.startsWith("PK\u0003\u0004") && (head.includes("xl/workbook") || head.includes("[Content_Types].xml"));
}

/** Cell values ExcelJS can hand back — plain, rich text, a hyperlink, or a formula's result. */
function excelCellToString(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((t) => t.text).join("");
    }
    if ("result" in value) return excelCellToString(value.result as CellValue);
    if ("text" in value) return String(value.text ?? ""); // hyperlink
  }
  return String(value);
}

/**
 * Reads an uploaded `.xlsx` workbook's first sheet into the same 2D-row
 * shape `parseHudlCsvText` already parses a CSV into, by way of
 * `Papa.unparse` (correct comma/quote escaping, no need to hand-roll it) —
 * every downstream step (header detection, column mapping, classifiers)
 * runs exactly as it does for a real CSV, no separate code path to drift.
 * `exceljs` is dynamically imported so CSV-only users never pay for it.
 */
export async function parseExcelFile(blob: Blob): Promise<HudlParseResult> {
  let rows: string[][];
  let sheetCount: number;
  let sheetName: string;
  try {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    const sheet = workbook.worksheets[0];
    rows = [];
    sheet?.eachRow({ includeEmpty: true }, (row) => {
      const values = row.values as CellValue[]; // 1-indexed; index 0 is unused
      rows.push(values.slice(1).map(excelCellToString));
    });
    sheetCount = workbook.worksheets.length;
    sheetName = sheet?.name ?? "Sheet1";
  } catch {
    return {
      cards: [],
      columns: {},
      missingColumns: [...CORE_FIELDS],
      warnings: ["Couldn't read this Excel file. Re-save it in Excel and try again, or export as CSV instead."],
      rowCount: 0,
    };
  }
  const result = parseHudlCsvText(Papa.unparse(rows));
  if (sheetCount > 1) {
    result.warnings = [`This workbook has ${sheetCount} sheets — only the first ("${sheetName}") was read.`, ...result.warnings];
  }
  return result;
}

/** Parses a Hudl breakdown from a `File`/`Blob` (browser upload, CSV or `.xlsx`) or raw CSV text. */
export async function parseHudlCsv(input: File | Blob | string): Promise<HudlParseResult> {
  if (typeof input !== "string") {
    const name = "name" in input ? (input as File).name : "";
    if (/\.xlsx$/i.test(name) || (await looksLikeExcelWorkbook(input))) {
      return parseExcelFile(input);
    }
  }
  const text = typeof input === "string" ? input : await input.text();
  return parseHudlCsvText(text);
}

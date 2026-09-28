import Papa from "papaparse";

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

  /** Every column of the original row, keyed by the normalized header. */
  raw: Record<string, string>;
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
  yardLine: ["YARD LN", "YARD LINE", "YARDLINE", "YD LN", "BALL ON", "FIELD POS"],
  hash: ["HASH", "HASH MARK", "HASH MARKS"],
  formation: ["OFF FORM", "OFF FORMATION", "FORMATION", "OFF FORM NAME"],
  playCall: ["OFF PLAY", "PLAY CALL", "OFF PLAY CALL", "PLAY TYPE"],
  playType: ["PLAY TYPE", "PLAY TYP", "RUN/PASS"],
  defFront: ["DEF FRONT", "FRONT", "DEF ALIGN", "DEF FORM", "DEF FORMATION"],
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

export function normalizeHeader(header: string): string {
  return header
    .replace(/^﻿/, "")
    .toUpperCase()
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Picks the CSV header to use for every field, honoring alias priority. */
export function mapColumns(headers: string[]): Partial<Record<HudlField, string>> {
  const available = new Set(headers.map(normalizeHeader));
  const columns: Partial<Record<HudlField, string>> = {};
  for (const field of Object.keys(COLUMN_ALIASES) as HudlField[]) {
    const match = COLUMN_ALIASES[field].find((alias) => available.has(alias));
    if (match) columns[field] = match;
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
  if (has(formation, /\s(PRO|SPLIT|SPLIT BACK|SPLITBACK|WEAK|STRONG|TWINS)\s/)) return "pro";
  if (has(formation, /\s(SPREAD|DOUBLES|DBLS|2X2|GUN|SHOTGUN|ACE|EMPTY|DOUBLE)\s/)) return "spread";
  return "unknown";
}

export function classifyFront(front: string): FrontKey {
  if (!front.trim()) return "unknown";
  const f = front.toUpperCase().replace(/\s+/g, " ");
  if (has(f, /\s(BEAR|46|DOUBLE EAGLE|DBL EAGLE)\s/)) return "bear";
  if (/\b5[\s-]?[23]\b|\bOKIE\b|\bOKLAHOMA\b|\b50\b/.test(f)) return "5-2";
  if (/\b3[\s-]?[34](?:[\s-]?5)?\b|\bTITE\b|\bMINT\b|\bSTACK\b/.test(f)) return "3-4";
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
    if (has(p, /\s(SWEEP|TOSS|PITCH|JET|FLY|BUCK SWEEP|REVERSE)\s/)) return "sweep";
    if (has(p, /\s(OZ|OUTSIDE ZONE|STRETCH|WIDE ZONE|OUTSIDE)\s/)) return "outside-zone";
    if (has(p, /\s(POWER|COUNTER|GT|TRAP|ISO|LEAD|BELLY|DART|G)\s/)) return "power";
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

const KNOWN_HEADERS = new Set(Object.values(COLUMN_ALIASES).flat());
/** How many rows from the top to search for the header row. */
const HEADER_SEARCH_ROWS = 25;

/**
 * Index of the header row: the first row with at least two known Hudl column
 * names (`PLAY #`, `DN`, `OFF FORM`, `OFF PLAY`, `FORMATION`, …). Title lines
 * and Excel `sep=,` lines above it are ignored. Returns -1 when none match.
 */
export function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, HEADER_SEARCH_ROWS);
  for (let i = 0; i < limit; i++) {
    const hits = rows[i].filter((c) => KNOWN_HEADERS.has(normalizeHeader(c))).length;
    if (hits >= 2) return i;
  }
  return -1;
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

/** Turns one keyed CSV row into a card. Exposed for tests. */
export function rowToCard(
  row: CsvRow,
  rowIndex: number,
  columns: Partial<Record<HudlField, string>>,
): HudlPlayCard {
  const playNumberRaw = cell(row, columns.playNumber);
  const parsedPlayNumber = Number.parseInt(playNumberRaw, 10);
  const playNumber = Number.isFinite(parsedPlayNumber) ? parsedPlayNumber : rowIndex + 1;

  const down = parseDown(cell(row, columns.down));
  const { distance, isGoalToGo } = parseDistance(cell(row, columns.distance));
  const yardLineLabel = cell(row, columns.yardLine);
  const formation = cell(row, columns.formation);
  const playCall = cell(row, columns.playCall);
  const playType = cell(row, columns.playType);
  const defFront = cell(row, columns.defFront);

  const formationSide = parseSide(formation) ?? "right";

  return {
    id: `play-${playNumber}-${rowIndex}`,
    playNumber,
    rowIndex,
    down,
    distance,
    isGoalToGo,
    downDistance: formatDownDistance(down, distance, isGoalToGo),
    yardLine: parseYardLine(yardLineLabel),
    yardLineLabel,
    hash: parseHash(cell(row, columns.hash)),
    formation,
    formationKey: classifyFormation(formation),
    formationSide,
    playCall,
    playType,
    concept: classifyConcept(playCall, playType),
    playDirection: parseSide(playCall) ?? formationSide,
    defFront,
    frontKey: classifyFront(defFront),
    raw: row,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Parses Hudl breakdown CSV text synchronously:
 * sanitize → raw 2D rows → find the header row → map rows by column index.
 * Never throws; problems come back as `warnings` and valid rows always load.
 */
export function parseHudlCsvText(text: string): HudlParseResult {
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
  const columns = mapColumns(keys);

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

  // Rows with none of these filled in carry nothing to put on a card.
  const criticalColumns = [columns.playNumber, columns.formation, columns.playCall, columns.down];
  const cards: HudlPlayCard[] = [];
  let skipped = 0;
  let unreadable = 0;
  dataRows.forEach((values, rowIndex) => {
    try {
      const row = rowToRecord(keys, values);
      const blank = criticalColumns.every((c) => !cell(row, c));
      const card = rowToCard(row, rowIndex, columns);
      const hasPlayData = Boolean(card.formation || card.playCall || card.defFront);
      if (blank || !hasPlayData || cell(row, columns.odk).toUpperCase() === "K") {
        skipped += 1;
        return;
      }
      cards.push(card);
    } catch {
      unreadable += 1;
    }
  });

  if (unreadable > 0) {
    warnings.push(`Couldn't read ${plural(unreadable, "row")}; the rest loaded normally.`);
  }
  if (skipped > 0) {
    warnings.push(
      `Skipped ${plural(skipped, "row")} with no formation, play, or front (special teams or blank).`,
    );
  }

  return { cards, columns, missingColumns, warnings, rowCount: dataRows.length };
}

/** Parses a Hudl breakdown CSV from a `File` (browser upload) or raw text. */
export async function parseHudlCsv(input: File | Blob | string): Promise<HudlParseResult> {
  const text = typeof input === "string" ? input : await input.text();
  return parseHudlCsvText(text);
}

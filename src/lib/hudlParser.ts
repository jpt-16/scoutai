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

/** A parsed CSV row. `dynamicTyping` turns numeric cells into numbers. */
export type CsvRow = Record<string, string | number | boolean | null | undefined>;

function cell(row: CsvRow, column: string | undefined): string {
  if (!column) return "";
  const v = row[column];
  return v == null ? "" : String(v).trim();
}

function stringifyRow(row: CsvRow): Record<string, string> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v == null ? "" : String(v)]));
}

const KNOWN_HEADERS = new Set(Object.values(COLUMN_ALIASES).flat());
/** How far down the file to look for the header row. */
const HEADER_SEARCH_LINES = 25;

/**
 * Finds the real header row. Exports edited in Excel or Sheets often have a
 * title line ("Week 7 Breakdown") or an Excel `sep=,` line above the header.
 * PapaParse would read that line as a 1-column header and then report every
 * row as "Too many fields". Returns the text from the header row on, plus the
 * number of lines dropped above it.
 */
export function locateHeaderRow(text: string): { body: string; skippedLines: number } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  const limit = Math.min(lines.length, HEADER_SEARCH_LINES);
  for (let i = 0; i < limit; i++) {
    if (!lines[i].trim()) continue;
    const fields = Papa.parse<string[]>(lines[i], { delimiter: "" }).data[0] ?? [];
    const hits = fields.filter((f) => KNOWN_HEADERS.has(normalizeHeader(String(f)))).length;
    if (hits >= 2) return { body: lines.slice(i).join("\n"), skippedLines: i };
  }
  return { body: text, skippedLines: 0 };
}

/** Turns one normalized CSV row into a card. Exposed for tests. */
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
    raw: stringifyRow(row),
  };
}

/** Parses Hudl breakdown CSV text synchronously. */
export function parseHudlCsvText(text: string): HudlParseResult {
  const { body, skippedLines } = locateHeaderRow(text);
  const parsed = Papa.parse<CsvRow>(body, {
    header: true,
    // Auto-detect comma, tab, semicolon, or pipe (European Excel saves with ";").
    delimiter: "",
    skipEmptyLines: "greedy",
    // Numeric cells become numbers; `cell()` turns everything back into trimmed text.
    dynamicTyping: true,
    // Trims header keys ("  OFF FORM ", "OFF  PLAY"), strips a BOM, normalizes case.
    transformHeader: normalizeHeader,
    // Trims spaces around commas before dynamicTyping sees the value.
    transform: (value) => value.trim(),
  });

  const headers = parsed.meta.fields ?? [];
  const columns = mapColumns(headers);
  const warnings: string[] = [];
  if (skippedLines > 0) {
    warnings.push(
      `Skipped ${skippedLines} line${skippedLines === 1 ? "" : "s"} above the header row (title or notes).`,
    );
  }

  for (const error of parsed.errors.slice(0, 5)) {
    // Row numbers from Papa are 0-based data rows; show 1-based spreadsheet rows.
    const where = error.row != null ? ` (row ${error.row + 2 + skippedLines})` : "";
    warnings.push(`${error.message}${where}`);
  }
  if (parsed.errors.length > 5) {
    warnings.push(`…and ${parsed.errors.length - 5} more CSV issues.`);
  }

  const missingColumns = CORE_FIELDS.filter((field) => !columns[field]);
  if (!columns.formation && !columns.playCall && !columns.defFront) {
    warnings.push(
      "No formation, play, or front columns found. Is this a Hudl breakdown export?",
    );
  }

  const cards: HudlPlayCard[] = [];
  let skipped = 0;
  parsed.data.forEach((row, rowIndex) => {
    const odk = cell(row, columns.odk).toUpperCase();
    const card = rowToCard(row, rowIndex, columns);
    const hasPlayData = Boolean(card.formation || card.playCall || card.defFront);
    if (odk === "K" || !hasPlayData) {
      skipped += 1;
      return;
    }
    cards.push(card);
  });

  if (skipped > 0) {
    warnings.push(
      `Skipped ${skipped} row${skipped === 1 ? "" : "s"} with no formation, play, or front (special teams or blank).`,
    );
  }

  return { cards, columns, missingColumns, warnings, rowCount: parsed.data.length };
}

/** Parses a Hudl breakdown CSV from a `File` (browser upload) or raw text. */
export async function parseHudlCsv(input: File | Blob | string): Promise<HudlParseResult> {
  const text = typeof input === "string" ? input : await input.text();
  return parseHudlCsvText(text);
}

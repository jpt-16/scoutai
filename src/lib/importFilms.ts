import { combineFilms, parseHudlCsv, type HudlParseResult, type HudlPlayCard } from "./hudlParser";

export interface FilmImport {
  /** Plays from every file that had any, tagged with their film. */
  cards: HudlPlayCard[];
  /** Files that contributed plays. */
  films: string[];
  /** Files with no usable plays (not CSV, wrong columns, empty), with why. */
  failed: { name: string; result: HudlParseResult }[];
  /** Warnings from every file, prefixed with the file name when there are several. */
  warnings: string[];
}

/**
 * Parses several Hudl CSVs (one per film) into one set of plays. A bad file
 * never blocks the good ones; it's reported in `failed`.
 */
export async function importFilms(files: File[]): Promise<FilmImport> {
  const parsed = await Promise.all(
    files.map(async (file) => ({ name: file.name, result: await parseHudlCsv(file) })),
  );
  const good = parsed.filter((p) => p.result.cards.length > 0);
  const prefix = (name: string, w: string) => (files.length > 1 ? `${name}: ${w}` : w);
  return {
    cards: combineFilms(good.map((p) => ({ name: p.name, cards: p.result.cards }))),
    films: good.map((p) => p.name),
    failed: parsed.filter((p) => p.result.cards.length === 0),
    warnings: parsed.flatMap((p) =>
      p.result.cards.length > 0
        ? p.result.warnings.map((w) => prefix(p.name, w))
        : [prefix(p.name, p.result.unsupportedFile?.message ?? "No plays found in this file.")],
    ),
  };
}

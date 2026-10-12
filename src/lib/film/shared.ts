/**
 * What the browser and the server both need about film uploads, with no Node imports so it can sit in a
 * client bundle (jobs.ts uses node:crypto and can't).
 */

/** A clip is one play; Hudl's per-play exports are a few MB. */
export const MAX_CLIP_BYTES = 100 * 1024 * 1024;
/** How long uploaded film is kept after a game is processed. The game file stays. */
export const CLIP_RETENTION_DAYS = 14;

/** A clip name: a bare file name, no path, no leading dot, a video extension. */
export function isValidClipName(name: unknown): name is string {
  return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9 _.()+-]{0,119}\.(mp4|mov|m4v)$/i.test(name) && !name.includes("..");
}

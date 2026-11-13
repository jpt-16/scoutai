/**
 * Checks on a path a browser asks to write in the private Blob store. Kept out of the route files (a Next route
 * may only export its handlers) so they can be tested.
 */

/**
 * A file name with no folder in it, at a sane length. The store also holds the staff's saved copies, the game
 * files and the rate counters under folders (`sync/`, `film/`, `filmjobs/`, `ratelimit/`), so a browser that
 * names its own upload must not be able to point it into one: every one of those paths has a `/`.
 */
export function isBareFileName(pathname: unknown): boolean {
  return (
    typeof pathname === "string" &&
    pathname.length > 0 &&
    pathname.length <= 200 &&
    !pathname.includes("/") &&
    !pathname.includes("\\")
  );
}

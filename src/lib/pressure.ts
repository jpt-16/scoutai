/**
 * Blitzes, as this staff tags them. Their breakdown's COVERAGE column carries the pressure, not a coverage:
 * "6 - DOUBLE FIRE", "5 - DOUBLE FIRE", "5 - LB". The number is how many rush. **FIRE** is one outside backer
 * blitzing off the edge (which one doesn't matter to the staff), **DOUBLE FIRE** both outside backers, **LB** an
 * inside backer.
 *
 * `parsePressure` reads a tag into who comes; the Scout D card draws them (`formations.ts`, rush arrows from the
 * blitzers); `readPressure` (`pressureRead.ts`) reads the same thing off film. Framework-free.
 */

/** Who blitzes: an outside backer on the formation's strong or weak side, or an inside backer. */
export type Blitzer = "outside-strong" | "outside-weak" | "inside";

export interface Pressure {
  /** How many rush, when the tag says ("6 - DOUBLE FIRE" → 6). */
  rushers: number | null;
  /** The staff's name for it, as written: "DOUBLE FIRE", "FIRE", "LB". */
  call: string;
  blitzers: Blitzer[];
  /** A one-line description for the card's notes: "Double Fire: both outside backers off the edge, 6 rush." */
  describe: string;
}

const norm = (tag: string) => ` ${tag.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()} `;

/** Whether a tag is a blitz call ("6 - DOUBLE FIRE", "FIRE", "5 - LB") rather than a coverage. */
export function isPressureTag(tag: string): boolean {
  const t = norm(tag);
  return / FIRE /.test(t) || /^\s*\d+\s*-/.test(tag) || / BLITZ /.test(t);
}

/** Reads a blitz tag, or null when it isn't one. */
export function parsePressure(tag: string): Pressure | null {
  if (!isPressureTag(tag)) return null;
  const t = norm(tag);
  const count = tag.match(/^\s*(\d+)\s*-/)?.[1] ?? t.match(/ (\d+) MAN RUSH /)?.[1];
  const rushers = count ? Number(count) : null;
  let call: string;
  let blitzers: Blitzer[];
  if (/ DOUBLE FIRE | DBL FIRE /.test(t)) {
    call = "DOUBLE FIRE";
    blitzers = ["outside-strong", "outside-weak"];
  } else if (/ FIRE /.test(t)) {
    call = "FIRE";
    // Either side is a FIRE; the card draws it from the strong side.
    blitzers = ["outside-strong"];
  } else if (/ (LB|MIKE|MIKE BLITZ|BACKER|ILB) /.test(t)) {
    call = "LB";
    blitzers = ["inside"];
  } else {
    // A rush count with a name we don't know: say the count, draw nobody extra.
    call = tag.replace(/^\s*\d+\s*-\s*/, "").trim().toUpperCase() || "BLITZ";
    blitzers = [];
  }
  const who =
    call === "DOUBLE FIRE"
      ? "both outside backers off the edge"
      : call === "FIRE"
        ? "an outside backer off the edge"
        : call === "LB"
          ? "an inside backer"
          : "";
  const title = call
    .toLowerCase()
    .split(" ")
    .map((w) => (w === "lb" ? "LB" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
  const describe = [title + (who ? `: ${who}` : ""), rushers ? `${rushers} rush` : ""].filter(Boolean).join(", ") + ".";
  return { rushers, call, blitzers, describe };
}

/** The tag as the staff writes it, from what was read: "6 - DOUBLE FIRE", "5 - FIRE", "5 - LB". */
export function pressureTag(rushers: number, blitzers: Blitzer[]): string | null {
  const outside = blitzers.filter((b) => b !== "inside").length;
  const inside = blitzers.includes("inside");
  const call = outside >= 2 ? "DOUBLE FIRE" : outside === 1 ? "FIRE" : inside ? "LB" : null;
  return call ? `${rushers} - ${call}` : null;
}

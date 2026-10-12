/**
 * Script export for field screens: one card per page (a PDF) or one card per
 * image (a ZIP of PNGs), sized for the display it's headed to. The CoachPad and
 * similar 13.3" sideline tablets load a PDF or an image set over cloud sync or
 * USB, so ScoutCard AI is the upstream card maker and this is the hand-off.
 *
 * Pure layout math and names; the rendering (html-to-image, jsPDF, JSZip) is in
 * `src/components/ExportModal.tsx`. Framework-free for Vitest.
 */

/** One card as it is printed or exported: the play and the lens it is seen through. */
export interface CardView<C> {
  card: C;
  unit: "offense" | "defense";
}

/**
 * The cards of a view as pages. With `pair`, every play gives two cards from the one read, its Scout O card then its
 * Scout D card (so they sit side by side on a 2-up sheet and stay together in an export); otherwise one card each.
 */
export function cardViews<C extends { scoutSide?: "offense" | "defense" }>(
  cards: C[],
  unit: "offense" | "defense",
  pair = false,
): CardView<C>[] {
  // A play of the scouted team has only its own side's card: on offense its Scout O, on defense its Scout D.
  return pair
    ? cards.flatMap((card) =>
        (["offense", "defense"] as const).filter((lens) => !card.scoutSide || card.scoutSide === lens).map((lens) => ({ card, unit: lens })),
      )
    : cards.map((card) => ({ card, unit }));
}

export interface ExportTarget {
  id: "coachpad" | "ipad" | "letter";
  label: string;
  detail: string;
  /** Page size in inches (landscape). */
  pageIn: { w: number; h: number };
  /** Rendered image size in pixels (same shape as the page). */
  px: { w: number; h: number };
}

export const EXPORT_TARGETS: ExportTarget[] = [
  {
    id: "coachpad",
    label: "CoachPad 13.3″ (4:3)",
    detail: "One card per page, fills a 13.3″ 4:3 sideline screen",
    // 13.3″ diagonal at 4:3: 10.64″ × 7.98″.
    pageIn: { w: 10.64, h: 7.98 },
    px: { w: 1600, h: 1200 },
  },
  {
    id: "ipad",
    label: "iPad (4:3)",
    detail: "One card per page for Files / Books on an iPad",
    pageIn: { w: 10.24, h: 7.68 },
    px: { w: 2048, h: 1536 },
  },
  {
    id: "letter",
    label: "Letter landscape",
    detail: "One card per sheet of paper",
    pageIn: { w: 11, h: 8.5 },
    px: { w: 2200, h: 1700 },
  },
];

/**
 * Where a card of `aspect` (width / height) sits on a page: as big as it fits
 * inside `margin` (a share of the short side), centered. Nothing is cropped,
 * so route labels and letters near the card's edges always make it.
 */
export function fitCard(
  page: { w: number; h: number },
  aspect: number,
  margin = 0.02,
): { x: number; y: number; w: number; h: number } {
  const pad = Math.min(page.w, page.h) * margin;
  const room = { w: page.w - 2 * pad, h: page.h - 2 * pad };
  const w = Math.min(room.w, room.h * aspect);
  const h = w / aspect;
  return { x: (page.w - w) / 2, y: (page.h - h) / 2, w, h };
}

const slug = (text: string, max = 40) =>
  text
    .toLowerCase()
    .replace(/\.(csv|xlsx)$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "") || "script";

/** "hendricken-scout-d-team-coachpad.pdf" */
export function exportFileName(
  script: string,
  unit: "offense" | "defense" | "both",
  mode: "team" | "7v7",
  target: ExportTarget["id"],
  ext: "pdf" | "zip",
): string {
  return `${slug(script)}-scout-${unit === "both" ? "o-d" : unit === "defense" ? "d" : "o"}-${mode === "7v7" ? "7v7" : "team"}-${target}.${ext}`;
}

/** "03-play-14-trips-right.png": ordered so a folder sorts in script order. */
export function imageName(
  index: number,
  total: number,
  playNumber: number,
  formation: string,
  unit?: "offense" | "defense",
): string {
  const width = Math.max(2, String(total).length);
  const lens = unit ? `-${unit === "defense" ? "d" : "o"}` : "";
  return `${String(index + 1).padStart(width, "0")}-play-${playNumber}${formation.trim() ? `-${slug(formation, 24)}` : ""}${lens}.png`;
}

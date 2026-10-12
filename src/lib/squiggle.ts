/**
 * Pre-snap motion is drawn as a squiggly line. Pure geometry, framework-free so it can be tested.
 */

export interface Pt {
  x: number;
  y: number;
}

/**
 * A wavy line from `a` to `b` (the motion notation), stopping `gap` short of `b` for the player's circle and the
 * arrowhead. Small waves (about 3 px either way, one every 12 px) along the straight line, as a smooth path.
 */
export function squigglePath(a: Pt, b: Pt, gap = 0): string {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return `M ${a.x} ${a.y}`;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const end = Math.max(0, len - gap);
  const step = 6;
  const amp = 3.2;
  const n = Math.max(2, Math.round(end / step));
  let d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)}`;
  for (let i = 1; i <= n; i++) {
    const t = (i * end) / n;
    const mid = ((i - 0.5) * end) / n;
    const side = i % 2 ? 1 : -1;
    const cx = a.x + ux * mid - uy * amp * 2 * side;
    const cy = a.y + uy * mid + ux * amp * 2 * side;
    d += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${(a.x + ux * t).toFixed(1)} ${(a.y + uy * t).toFixed(1)}`;
  }
  return d;
}

"""Finds the field in a frame: the yard lines, the sideline and hash rows, and from them the
matrix that puts any pixel on the field in yards. This replaces the four clicks of
`eval.calibrate`.

What a high school field gives you for free, and what it doesn't:

 * Yard lines every 5 yards, all parallel on the grass, so they are a fan of lines in the
   picture. Their spacing in the picture pins down the depth (a projective map of a row of
   equally spaced lines). Which number each one is cannot be told from lines alone, and doesn't
   matter here: everything downstream is yards from the ball, so the first line found is
   called 0 and the rest follow.
 * Rows that run the length of the field: the sidelines (long white lines) and the two hash
   rows (a tick every yard). Their spacing is known (NFHS: hashes 17.78 yards in from each
   sideline, 53.33 yards wide), which gives the other direction its scale.

Where a yard line crosses a row there is a point whose field position is known, and a
least-squares fit over all of those points is the matrix. A frame with too little to go on
(no lines, one row, rows that could be any pair of the four) returns a `FieldFailure` saying
why, so that clip goes back to a human instead of getting a confident wrong answer.

The field frame this returns is an ordinary rotated copy of the real one: the x axis points
right when you face along +y, which is all `eval.tracks` and `eval.presnap` need (they turn
it into the offense's own view with a direction). Whether it is the real 35 or the real 65
is not known and not needed.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field

import cv2
import numpy as np

FIELD_WIDTH = 160 / 3  # yards
HASH_IN = 17.78
ROW_X = (0.0, HASH_IN, FIELD_WIDTH - HASH_IN, FIELD_WIDTH)  # sideline, hash, hash, sideline
LINE_YARDS = 5.0

# A line this far (pixels) from another one is the same painted line seen twice.
MERGE_PIXELS = 12.0
MAX_LINES = 9
# Tick blobs: the size range (as a fraction of the frame width) of a hash mark, and how many
# of them in a row it takes to call it a row.
TICK_MIN, TICK_MAX = 0.0015, 0.03
MIN_TICKS_IN_ROW = 7
TICK_FIT_PIXELS = 3.0
# A fit this far off (yards, mean) is not a field.
MAX_RESIDUAL_YARDS = 0.8
# The runner-up subset of rows has to fit this much worse than the winner to call it unambiguous.
AMBIGUITY_RATIO = 1.5


@dataclass
class FieldFit:
    """The pixel -> field matrix and how it was found."""

    to_field: np.ndarray  # 3x3, pixels -> yards (x across, y along)
    residual: float  # mean yards between the fit and the points it was made from
    lines: int
    rows: int
    note: str = ""


@dataclass
class FieldFailure:
    reason: str
    detail: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------- finding marks


def _field_region(frame: np.ndarray) -> np.ndarray:
    """Where the grass is, filled in and grown a little so the sideline paint is inside it."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    green = cv2.inRange(hsv, (30, 45, 30), (95, 255, 255))
    k = max(5, frame.shape[1] // 80) | 1
    green = cv2.morphologyEx(green, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(green)
    if n <= 1:
        return np.zeros(green.shape, np.uint8)
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    blob = (labels == biggest).astype(np.uint8) * 255
    contours, _ = cv2.findContours(blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    region = np.zeros_like(blob)
    cv2.fillPoly(region, [cv2.convexHull(np.vstack(contours))], 255)
    return cv2.dilate(region, np.ones((k, k), np.uint8))


def paint_mask(frame: np.ndarray) -> np.ndarray:
    """White paint on the grass: much brighter than the grass around it, and not colored."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    sat = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)[..., 1]
    around = cv2.GaussianBlur(gray, (0, 0), max(4, frame.shape[1] / 160))
    bright = (gray.astype(np.int16) - around.astype(np.int16) > 25) & (sat < 90) & (gray > 110)
    mask = bright.astype(np.uint8) * 255
    return cv2.bitwise_and(mask, _field_region(frame))


@dataclass
class _Line:
    p: np.ndarray  # a point on it
    d: np.ndarray  # unit direction
    length: float

    def homogeneous(self) -> np.ndarray:
        a, b = -self.d[1], self.d[0]
        return np.array([a, b, -(a * self.p[0] + b * self.p[1])])

    def distance(self, pt: np.ndarray) -> float:
        return abs(float(np.dot(pt - self.p, (-self.d[1], self.d[0]))))


def _fit_line(points: np.ndarray, length: float) -> _Line:
    vx, vy, x0, y0 = cv2.fitLine(points.astype(np.float32), cv2.DIST_L2, 0, 0.01, 0.01).ravel()
    return _Line(np.array([x0, y0], float), np.array([vx, vy], float), length)


def _segments(mask: np.ndarray) -> list[tuple[np.ndarray, np.ndarray]]:
    w = mask.shape[1]
    found = cv2.HoughLinesP(
        mask, 1, np.pi / 720, threshold=50, minLineLength=int(0.10 * w), maxLineGap=int(0.015 * w) + 8
    )
    if found is None:
        return []
    return [(np.array(s[:2], float), np.array(s[2:], float)) for s in np.asarray(found).reshape(-1, 4)]


def _consensus(segs: list[tuple[np.ndarray, np.ndarray]], rng: np.random.Generator) -> list[bool]:
    """The segments that all point at one spot (a vanishing point, possibly at infinity): the
    yard lines are one such fan, and the sideline and hash rows another."""
    n = len(segs)
    mids = np.array([(a + b) / 2 for a, b in segs])
    dirs = np.array([(b - a) / max(np.linalg.norm(b - a), 1e-9) for a, b in segs])
    lengths = np.array([np.linalg.norm(b - a) for a, b in segs])
    homog = [np.cross([*a, 1.0], [*b, 1.0]) for a, b in segs]
    best_score, best = -1.0, np.zeros(n, bool)
    for _ in range(300):
        i, j = rng.choice(n, 2, replace=False)
        v = np.cross(homog[i], homog[j])
        if np.linalg.norm(v) < 1e-9:
            continue
        if abs(v[2]) < 1e-9 * np.linalg.norm(v):
            toward = np.tile(v[:2] / np.linalg.norm(v[:2]), (n, 1))
        else:
            toward = v[:2] / v[2] - mids
            toward /= np.maximum(np.linalg.norm(toward, axis=1, keepdims=True), 1e-9)
        cos = np.abs(np.sum(toward * dirs, axis=1))
        inliers = cos > np.cos(np.radians(1.5))
        score = float(lengths[inliers].sum())
        if score > best_score:
            best_score, best = score, inliers
    return list(best)


def _split_families(segs: list[tuple[np.ndarray, np.ndarray]]) -> tuple[list, list]:
    """The yard-line fan and the rows that cross it, in a way that doesn't care which way up
    the picture is or how wide the fan opens."""
    if len(segs) < 3:
        return segs, []
    rng = np.random.default_rng(11)
    first = _consensus(segs, rng)
    one = [s for s, m in zip(segs, first) if m]
    rest = [s for s, m in zip(segs, first) if not m]
    if len(rest) < 3:
        return one, rest
    second = _consensus(rest, rng)
    return one, [s for s, m in zip(rest, second) if m]


def _merge(segs: list[tuple[np.ndarray, np.ndarray]]) -> list[_Line]:
    """Segments that lie on one painted line become one line."""
    groups: list[list[tuple[np.ndarray, np.ndarray]]] = []
    lines: list[_Line] = []
    for a, b in sorted(segs, key=lambda s: -np.linalg.norm(s[1] - s[0])):
        mid = (a + b) / 2
        d = (b - a) / max(np.linalg.norm(b - a), 1e-9)
        for idx, ln in enumerate(lines):
            angle = np.degrees(np.arccos(min(1.0, abs(float(np.dot(d, ln.d))))))
            if angle < 4 and ln.distance(mid) < MERGE_PIXELS:
                groups[idx].append((a, b))
                pts = np.array([p for s in groups[idx] for p in s])
                lines[idx] = _fit_line(pts, float(np.ptp(pts, axis=0).max()))
                break
        else:
            groups.append([(a, b)])
            lines.append(_fit_line(np.array([a, b]), float(np.linalg.norm(b - a))))
    return lines


def _tick_rows(mask: np.ndarray, rng: np.random.Generator) -> list[_Line]:
    """Rows of small white marks (the hashes): a line through many of them."""
    w = mask.shape[1]
    n, _, stats, cents = cv2.connectedComponentsWithStats(mask)
    pts = []
    for i in range(1, n):
        side = max(stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]) / w
        if TICK_MIN <= side <= TICK_MAX:
            pts.append(cents[i])
    pts_a = np.array(pts)
    rows: list[_Line] = []
    for _ in range(4):
        if len(pts_a) < MIN_TICKS_IN_ROW:
            break
        best: np.ndarray | None = None
        for _ in range(500):
            i, j = rng.choice(len(pts_a), 2, replace=False)
            d = pts_a[j] - pts_a[i]
            norm = np.linalg.norm(d)
            if norm < 0.05 * w:
                continue
            d /= norm
            off = np.abs((pts_a - pts_a[i]) @ np.array([-d[1], d[0]]))
            inliers = off < TICK_FIT_PIXELS
            if best is None or inliers.sum() > best.sum():
                best = inliers
        if best is None or best.sum() < MIN_TICKS_IN_ROW:
            break
        got = pts_a[best]
        if np.ptp(got, axis=0).max() < 0.2 * w:
            break
        rows.append(_fit_line(got, float(np.ptp(got, axis=0).max())))
        pts_a = pts_a[~best]
    return rows


# ---------------------------------------------------------------------- numbering the lines


def _intersect(a: _Line, b: _Line) -> np.ndarray | None:
    p = np.cross(a.homogeneous(), b.homogeneous())
    if abs(p[2]) < 1e-9:
        return None
    return p[:2] / p[2]


def number_lines(lines: list[_Line]) -> tuple[list[tuple[_Line, int]], float] | None:
    """Which yard line (in 5-yard steps, from 0) each one is, and how well they fit.

    Along any line across them the lines sit at positions t = (a k + b) / (c k + 1) for the
    k-th one: equal spacing in the field seen in perspective. Try every way of letting a gap
    be one, two or three steps (a line the paint or the lighting lost) and keep the best fit,
    preferring fewer lost lines.
    """
    if len(lines) < 3:
        return None
    mean_d = np.mean([l.d if l.d[0] * lines[0].d[0] + l.d[1] * lines[0].d[1] > 0 else -l.d for l in lines], axis=0)
    mean_d /= np.linalg.norm(mean_d)
    across = np.array([-mean_d[1], mean_d[0]])
    center = np.mean([l.p for l in lines], axis=0)
    ts = []
    for l in lines:
        # Where the transversal through the center (running across the lines) meets this one.
        a = l.homogeneous()
        denom = float(a[:2] @ across)
        if abs(denom) < 1e-6:
            return None
        ts.append(-(a[:2] @ center + a[2]) / denom)
    order = np.argsort(ts)
    lines = [lines[i] for i in order][:MAX_LINES]
    t = np.array(sorted(ts))[:MAX_LINES]
    span = float(t[-1] - t[0])
    n = len(t)
    best: tuple[float, list[int]] | None = None
    for gaps in itertools.product((1, 2, 3), repeat=n - 1):
        k = np.concatenate([[0], np.cumsum(gaps)]).astype(float)
        design = np.stack([k, np.ones(n), -k * t], axis=1)
        sol, *_ = np.linalg.lstsq(design, t, rcond=None)
        a, b, c = sol
        den = c * k + 1
        if np.any(den <= 0.05):  # the map blows up inside the range: not a field
            continue
        pred = (a * k + b) / den
        rms = float(np.sqrt(np.mean((pred - t) ** 2)))
        # Monotone and the right way round, or it isn't a ruler.
        if np.any(np.diff(pred) <= 0):
            continue
        cost = rms / max(span, 1.0) * 1000 + 0.6 * (sum(gaps) - (n - 1))
        if best is None or cost < best[0]:
            best = (cost, list(k.astype(int)))
    if best is None:
        return None
    cost, k = best
    return list(zip(lines, k)), cost


# ------------------------------------------------------------------------------ the matrix


def _orientation_ok(to_field: np.ndarray, around: np.ndarray) -> bool:
    """A camera looking down at the grass keeps handedness: with the picture's y pointing down,
    the map pixels -> (x right when facing +y, y) has a negative determinant. The other sign
    would be a mirror image of the field."""
    eps = 4.0
    pts = np.float32([[around], [around + (eps, 0)], [around + (0, eps)]])
    out = cv2.perspectiveTransform(pts.reshape(1, -1, 2), to_field).reshape(-1, 2)
    jx = (out[1] - out[0]) / eps
    jy = (out[2] - out[0]) / eps
    return float(jx[0] * jy[1] - jx[1] * jy[0]) < 0


def calibrate_field(frame: np.ndarray, seed: int = 7) -> FieldFit | FieldFailure:
    """Finds the field in one frame. Returns the pixel -> yards matrix or says why not."""
    mask = paint_mask(frame)
    segs = _segments(mask)
    if len(segs) < 3:
        return FieldFailure("no_lines", {"segments": len(segs)})

    family_a, family_b = _split_families(segs)
    lines_a, lines_b = _merge(family_a), _merge(family_b)
    # The yard lines are the family with more lines in it; the rows are the other.
    yard_lines, long_rows = (lines_a, lines_b) if len(lines_a) >= len(lines_b) else (lines_b, lines_a)
    numbered = number_lines(yard_lines)
    if numbered is None:
        return FieldFailure("yard_lines", {"found": len(yard_lines)})
    numbered_lines, line_cost = numbered

    rng = np.random.default_rng(seed)
    rows = list(long_rows)
    for tick_row in _tick_rows(mask, rng):
        # A row of ticks along a sideline that is already a long line is the same row.
        mid = tick_row.p
        if not any(r.distance(mid) < MERGE_PIXELS and abs(float(np.dot(r.d, tick_row.d))) > 0.97 for r in rows):
            rows.append(tick_row)
    if len(rows) < 3:
        return FieldFailure("rows", {"found": len(rows), "need": 3})
    rows = rows[:4]

    # Order the rows across the field by where they meet the middle yard line.
    middle = numbered_lines[len(numbered_lines) // 2][0]
    spots = [_intersect(middle, r) for r in rows]
    if any(s is None for s in spots):
        return FieldFailure("rows", {"reason": "a row never meets the yard lines"})
    along = np.array([float(np.dot(s - middle.p, middle.d)) for s in spots])
    rows = [rows[i] for i in np.argsort(along)]

    cross = [[_intersect(row, line) for line, _ in numbered_lines] for row in rows]
    if any(p is None for r in cross for p in r):
        return FieldFailure("rows", {"reason": "parallel to a yard line"})
    pixels = np.array([p for r in cross for p in r], np.float32)
    center = pixels.mean(axis=0)

    best_by_subset: dict[tuple[float, ...], tuple[float, np.ndarray]] = {}
    for subset in itertools.combinations(range(4), len(rows)):
        for flip_x, flip_y in itertools.product((False, True), repeat=2):
            xs = [ROW_X[i] for i in subset]
            if flip_x:
                xs = xs[::-1]
            world = []
            for xi, r in zip(xs, cross):
                for (_, k), _p in zip(numbered_lines, r):
                    world.append((xi, (-1 if flip_y else 1) * LINE_YARDS * k))
            to_pixel, _ = cv2.findHomography(np.float32(world), pixels, 0)
            if to_pixel is None:
                continue
            try:
                to_field = np.linalg.inv(to_pixel)
            except np.linalg.LinAlgError:
                continue
            if not _orientation_ok(to_field, center):
                continue
            back = cv2.perspectiveTransform(pixels.reshape(1, -1, 2), to_field).reshape(-1, 2)
            residual = float(np.mean(np.linalg.norm(back - np.float32(world), axis=1)))
            key = tuple(ROW_X[i] for i in subset)
            if key not in best_by_subset or residual < best_by_subset[key][0]:
                best_by_subset[key] = (residual, to_field)

    if not best_by_subset:
        return FieldFailure("orientation", {})
    ranked = sorted(best_by_subset.items(), key=lambda kv: kv[1][0])
    (rows_x, (residual, to_field)) = ranked[0]
    if residual > MAX_RESIDUAL_YARDS:
        return FieldFailure("fit", {"residual": round(residual, 2)})
    if len(ranked) > 1 and ranked[1][1][0] < residual * AMBIGUITY_RATIO and len(rows) < 4:
        return FieldFailure(
            "ambiguous_rows",
            {"best": rows_x, "runner_up": ranked[1][0], "residuals": [round(residual, 3), round(ranked[1][1][0], 3)]},
        )
    return FieldFit(
        to_field=to_field,
        residual=residual,
        lines=len(numbered_lines),
        rows=len(rows),
        note=f"rows at x={rows_x}",
    )

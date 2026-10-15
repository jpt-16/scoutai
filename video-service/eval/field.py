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
import os
from dataclasses import dataclass, field

import cv2
import numpy as np

FIELD_WIDTH = 160 / 3  # yards, at every level
# Where the hash marks are, in yards in from each sideline: high school (NFHS) 53' 4", college 60', the NFL 70' 9". Set
# `FIELD_LEVEL` (hs, college, nfl) for film that isn't high school, or every calibration puts the hash rows in the wrong place.
HASH_IN_BY_LEVEL = {"hs": 17.78, "college": 20.0, "nfl": 23.58}
FIELD_LEVEL = os.environ.get("FIELD_LEVEL", "hs").strip().lower() or "hs"
if FIELD_LEVEL not in HASH_IN_BY_LEVEL:
    raise SystemExit(f"FIELD_LEVEL must be one of {', '.join(HASH_IN_BY_LEVEL)} (got {FIELD_LEVEL!r})")
HASH_IN = HASH_IN_BY_LEVEL[FIELD_LEVEL]
ROW_X = (0.0, HASH_IN, FIELD_WIDTH - HASH_IN, FIELD_WIDTH)  # sideline, hash, hash, sideline
LINE_YARDS = 5.0

# Grass: green hue, at least this saturated, and no brighter than this (paint is). Turf under lights at night is a dull green:
# on the CM vs Andover film its saturation runs 25-65 (median 50; last game's field ~90), so a cutoff of 40-45 threw out a quarter
# of the field, the "grass all around it" test then failed along every yard line, and the field finder saw two lines of a dozen.
GRASS_MIN_SAT = 20
GRASS_MAX_VALUE = 200

# A line this far (pixels) from another one is the same painted line seen twice.
MERGE_PIXELS = 12.0
# How much brighter than its surroundings paint has to be (levels of 255).
PAINT_CONTRAST = 10
MAX_LINES = 9
# The longest few candidate rows are tried in every combination of four (and three).
MAX_ROWS = 7
# Tick blobs: the size range (as a fraction of the frame width) of a hash mark, and how many
# of them in a row it takes to call it a row.
TICK_MIN, TICK_MAX = 0.0015, 0.03
MIN_TICKS_IN_ROW = 7
TICK_FIT_PIXELS = 3.0
# A ruler of yard lines whose lines sit this far from equal spacing (see `number_lines`) isn't one.
LINE_COST_MAX = 4.0
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
    green = cv2.inRange(hsv, (30, GRASS_MIN_SAT, 30), (95, 255, GRASS_MAX_VALUE))
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
    """White paint on the grass: brighter than the grass around it, not colored, and with grass
    all around it. That last test is what throws out jerseys, helmets, the bench and the
    crowd: they are bright too, but they are not in a field of grass, while a painted line is.
    (Real film: worn lines are only ~10 levels brighter than the turf, and the sideline is
    lined with white pants.)"""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    around = cv2.GaussianBlur(gray, (0, 0), max(4, frame.shape[1] / 160))
    bright = (gray.astype(np.int16) - around.astype(np.int16) > PAINT_CONTRAST) & (hsv[..., 1] < 110) & (gray > 90)
    grass = cv2.inRange(hsv, (30, GRASS_MIN_SAT, 25), (95, 255, GRASS_MAX_VALUE)) > 0
    k = max(15, (frame.shape[1] // 50) | 1)
    near_grass = cv2.blur(grass.astype(np.float32), (k, k)) > 0.55
    mask = (bright & near_grass).astype(np.uint8) * 255
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


def number_lines(lines: list[_Line]) -> tuple[list[tuple[_Line, int]], float, list[float]] | None:
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
    best: tuple[float, list[int], list[float]] | None = None
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
            best = (cost, [int(v) for v in k], [float(abs(v)) for v in pred - t])
    if best is None:
        return None
    cost, k, resid = best
    return list(zip(lines, k)), cost, resid


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


def upright(calibration: dict) -> dict:
    """The clip's calibration with the field the right way round. Hand calibrations name the yard lines by their painted
    numbers, and those run both ways from midfield, so a hand fit can come out as a mirror image of the field (CM vs Andover's
    plays 67 and 97 did: every receiver landed on the wrong side of the ball). A mirror is impossible for a camera looking down
    at grass (`_orientation_ok`), so it is turned back: the yard axis is reversed and the direction with it, which leaves
    downfield where it was and puts the offense's left and right back. A calibration already the right way round is returned as is."""
    src = np.float32(calibration["source"])
    dst = np.float32(calibration["destination"])
    to_field = cv2.getPerspectiveTransform(src, dst)
    if _orientation_ok(to_field, np.float32(calibration["ball"])):
        return calibration
    flipped = [[float(x), float(-y)] for x, y in calibration["destination"]]
    return {**calibration, "destination": flipped, "direction": -int(calibration["direction"])}


def number_lines_robust(lines: list[_Line]) -> tuple[list[tuple[_Line, int]], float] | None:
    """`number_lines`, throwing out the line that fits worst until the rest are a clean ruler.
    Real film is full of lines that are not yard lines (a bench, a banner, a long shadow)."""
    lines = list(lines)
    while len(lines) >= 3:
        got = number_lines(lines)
        if got is None:
            # No ruler at all: the worst we can do is drop the shortest line and look again.
            lines.remove(min(lines, key=lambda l: l.length))
            continue
        numbered, cost, resid = got
        if cost <= LINE_COST_MAX:
            return numbered, cost
        kept = [l for l, _ in numbered]
        lines = [l for l in kept]
        lines.pop(int(np.argmax(resid)))
    return None


def _fit_rows(numbered_lines: list[tuple[_Line, int]], rows: list[_Line]):
    """Best matrix for these rows against these yard lines over every way the rows could be the
    four known across-field positions. Returns {positions: (residual, to_field)} or a failure reason."""
    middle = numbered_lines[len(numbered_lines) // 2][0]
    spots = [_intersect(middle, r) for r in rows]
    if any(s is None for s in spots):
        return "a row never meets the yard lines"
    along = np.array([float(np.dot(s - middle.p, middle.d)) for s in spots])
    rows = [rows[i] for i in np.argsort(along)]
    cross = [[_intersect(row, line) for line, _ in numbered_lines] for row in rows]
    if any(p is None for r in cross for p in r):
        return "a row is parallel to a yard line"
    pixels = np.array([p for r in cross for p in r], np.float32)
    center = pixels.mean(axis=0)
    best_by_subset: dict[tuple[float, ...], tuple[float, np.ndarray]] = {}
    for subset in itertools.combinations(range(4), len(rows)):
        for flip_x, flip_y in itertools.product((False, True), repeat=2):
            xs = [ROW_X[i] for i in subset]
            if flip_x:
                xs = xs[::-1]
            world = [(xi, (-1 if flip_y else 1) * LINE_YARDS * k) for xi in xs for _, k in numbered_lines]
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
    return best_by_subset or "orientation"


def _solve(yard_lines: list[_Line], rows: list[_Line]) -> FieldFit | FieldFailure:
    numbered = number_lines_robust(yard_lines)
    if numbered is None:
        return FieldFailure("yard_lines", {"found": len(yard_lines)})
    numbered_lines, _ = numbered
    if len(rows) < 3:
        return FieldFailure("rows", {"found": len(rows), "need": 3})
    rows = sorted(rows, key=lambda r: -r.length)[:MAX_ROWS]
    # Some of the rows may not be rows (a banner, a shadow): try the best four, then the best three.
    best: tuple[float, tuple[float, ...], np.ndarray, int, float] | None = None
    for size in (4, 3):
        if size > len(rows):
            continue
        for chosen in itertools.combinations(rows, size):
            got = _fit_rows(numbered_lines, list(chosen))
            if isinstance(got, str):
                continue
            ranked = sorted(got.items(), key=lambda kv: kv[1][0])
            (rows_x, (residual, to_field)) = ranked[0]
            gap = ranked[1][1][0] / max(residual, 1e-6) if len(ranked) > 1 else np.inf
            if best is None or residual < best[0]:
                best = (residual, rows_x, to_field, size, gap)
        if best is not None and best[0] <= MAX_RESIDUAL_YARDS:
            break
    if best is None:
        return FieldFailure("orientation", {})
    residual, rows_x, to_field, size, gap = best
    if residual > MAX_RESIDUAL_YARDS:
        return FieldFailure("fit", {"residual": round(residual, 2)})
    if gap < AMBIGUITY_RATIO and size < 4:
        return FieldFailure("ambiguous_rows", {"best": rows_x, "gap": round(float(gap), 2)})
    return FieldFit(to_field=to_field, residual=residual, lines=len(numbered_lines), rows=size, note=f"rows at x={rows_x}")


def field_candidates(frame: np.ndarray, seed: int = 7) -> list[FieldFit] | FieldFailure:
    """Every way the frame's lines can be a field, best first (more yard lines, then a tighter fit).

    A row of four evenly spaced lines (sideline, hash, hash, sideline: 17.78 yards apart) looks
    exactly like four yard lines, so when the picture is ambiguous both readings come back and
    the caller picks with something the paint can't tell it (`autocalib` uses how far apart the
    men on the line stand: about a yard, not three and a half)."""
    mask = paint_mask(frame)
    segs = _segments(mask)
    if len(segs) < 3:
        return FieldFailure("no_lines", {"segments": len(segs)})
    family_a, family_b = _split_families(segs)
    lines_a, lines_b = _merge(family_a), _merge(family_b)
    rng = np.random.default_rng(seed)
    ticks_a, ticks_b = [], []
    for tick_row in _tick_rows(mask, rng):
        # A row of ticks along a sideline that is already a long line is the same row.
        for fam, bucket in ((lines_a, ticks_a), (lines_b, ticks_b)):
            if not any(r.distance(tick_row.p) < MERGE_PIXELS and abs(float(np.dot(r.d, tick_row.d))) > 0.97 for r in fam):
                bucket.append(tick_row)
    tries = [_solve(lines_a, lines_b + ticks_a + ticks_b), _solve(lines_b, lines_a + ticks_a + ticks_b)]
    fits = sorted((t for t in tries if isinstance(t, FieldFit)), key=lambda f: (-f.lines, f.residual))
    if fits:
        return fits
    order = ["no_lines", "yard_lines", "rows", "orientation", "fit", "ambiguous_rows"]
    return max(tries, key=lambda t: order.index(t.reason) if t.reason in order else 0)


def calibrate_field(frame: np.ndarray, seed: int = 7) -> FieldFit | FieldFailure:
    """Finds the field in one frame. Returns the pixel -> yards matrix or says why not."""
    got = field_candidates(frame, seed)
    return got if isinstance(got, FieldFailure) else got[0]

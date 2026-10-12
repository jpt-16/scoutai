"""Does the calibration put the offense's line on one line? A check no paint fit can fake.

    python -m eval.calibcheck tracks/play_34.json [more.json ...]

The men standing on the ball at the snap must sit at one depth, in a row about a yard apart. A homography that skews
the field (play 34's near side read 4 yd downfield) shows up as a line that is tilted or spread. This reads a tracks
file (yards from the ball, offense's view, y upfield) and answers `ok` or says why not, so a skewed clip is sent to
a hand fit instead of being trusted.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

INLIER_YARDS = 0.9        # a man within this of the fitted row is on the line
MAX_SLOPE = 0.6           # a row steeper than this is not a line of scrimmage
MAX_SPREAD_YARDS = 0.8    # the line's depth, tallest to shortest, after a straight line is taken out
MAX_TILT_YARDS = 1.0      # how far the line's ends sit apart in depth across the 5-man width
MIN_LINE = 4
BOX_X = 9.0               # the box: linemen are never wider than this from the ball
WINDOW_SECONDS = 0.3


def spots_at(tracks: dict, seconds: float) -> list[tuple[float, float]]:
    out = []
    for t in tracks["tracks"]:
        if t.get("team") != "offense":
            continue
        near = [p for p in t["points"] if abs(p[0] - seconds) <= WINDOW_SECONDS]
        if near:
            _, x, y = min(near, key=lambda p: abs(p[0] - seconds))
            out.append((x, y))
    return out


def check_line(spots: list[tuple[float, float]]) -> dict:
    """Find the straight row of men in the box (most men within `INLIER_YARDS` of one line, any gentle slope);
    say how tilted and how ragged it is. Taking the row by a line, not a depth band, is what lets a tilt be seen."""
    box = [(x, y) for x, y in spots if abs(x) <= BOX_X]
    best: list[tuple[float, float]] = []
    for i, (x1, y1) in enumerate(box):
        for x2, y2 in box[i + 1:]:
            if abs(x2 - x1) < 1.0:
                continue
            slope = (y2 - y1) / (x2 - x1)
            if abs(slope) > MAX_SLOPE:
                continue
            row = [(x, y) for x, y in box if abs(y - (y1 + slope * (x - x1))) <= INLIER_YARDS]
            if len(row) > len(best):
                best = row
    if len(best) < MIN_LINE:
        return {"ok": False, "why": f"only {len(best)} men found in a row on the ball (need {MIN_LINE})", "men": len(best)}
    xs = np.array([p[0] for p in best])
    ys = np.array([p[1] for p in best])
    slope, intercept = np.polyfit(xs, ys, 1)
    tilt = float(abs(slope) * np.ptp(xs))
    spread = float(np.ptp(ys - (slope * xs + intercept)))
    ok = spread <= MAX_SPREAD_YARDS and tilt <= MAX_TILT_YARDS
    why = "" if ok else f"line is {tilt:.1f} yd tilted and {spread:.1f} yd ragged (limits {MAX_TILT_YARDS}/{MAX_SPREAD_YARDS})"
    return {"ok": ok, "why": why, "men": len(best), "tilt": round(tilt, 2), "spread": round(spread, 2), "depth": round(float(ys.mean()), 2)}


def check_tracks(tracks: dict) -> dict:
    """Checked at the snap and a second before it; the better of the two stands (one frame can lose a man)."""
    snap = float((tracks.get("formations") or {}).get("snapSeconds") or 0.0)
    reads = [check_line(spots_at(tracks, max(0.0, snap + d))) for d in (0.0, -0.5, -1.0)]
    good = [r for r in reads if r["ok"]]
    return good[0] if good else max(reads, key=lambda r: r["men"])


def main() -> None:
    bad = 0
    for path in sys.argv[1:]:
        r = check_tracks(json.loads(Path(path).read_text()))
        bad += not r["ok"]
        print(f"{Path(path).name}: {'ok' if r['ok'] else 'NEEDS A HAND'}  {r.get('why') or ''} (men {r['men']}, spread {r.get('spread')}, tilt {r.get('tilt')})")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()

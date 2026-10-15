"""How often a tracks file has each man on his own track, against positions marked by hand.

    python -m eval.truth tracks/play_05.json eval/truth/play_05.json [--dump detections/play_05_detections.json [--calibration play_05.json]]

Route names say whether the whole chain worked; this says whether the tracker did. A truth file marks where each
receiver really was at a few frames (yards from the ball, offense's view; see `truth/play_05.json`). His track is
the one on him at the first of his marks where any track is (earlier marks count as missing); a later mark counts as right when that track is within `HIT_YARDS` of it
(within two frames), wrong when the track is somewhere else, and missing when the track has ended or skipped it.

With the run's saved detections (`--dump`), each man also gets how often the detector found him at all: a raw box (any team,
before every filter; referees aside) within `HIT_YARDS` of his mark in that frame. Found but not on his track is the tracker's
miss; not found is the detector's, and no tracker can follow a man the detector doesn't see.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

HIT_YARDS = 1.5
NEAR_FRAMES = 2


def raw_spots(dump: dict) -> list[list[tuple[float, float]]]:
    """Every raw detector box of each frame of a saved dump (`--detections`), as a spot in yards from the ball in the offense's view,
    put on the field the way the tracker puts him (`people.feet_locator`, the box's top and bottom through the camera hold)."""
    import cv2

    from geometry import CalibrationPoints, build_homography

    from .people import feet_locator

    cal = dump["calibration"]
    locate = feet_locator(build_homography(CalibrationPoints(source=cal["source"], destination=cal["destination"])))
    ball, direction = dump["ball"], dump["direction"]
    out = []
    for raw, m in zip(dump["raw"], dump["to_snap"]):
        to_snap = np.array(m, dtype=np.float64)
        here = []
        for r in raw:
            if r.get("official"):
                continue
            b = r["box"]
            cx = (b[0] + b[2]) / 2
            top, bottom = cv2.perspectiveTransform(np.float32([[[cx, b[1]], [cx, b[3]]]]), to_snap)[0]
            fx, fy = locate((float(bottom[0]), float(top[1]), float(bottom[0]), float(bottom[1]), r["score"]))
            here.append(((fx - ball[0]) * direction, (fy - ball[1]) * direction))
        out.append(here)
    return out


def found(spots: list[list[tuple[float, float]]], truth: dict) -> dict[str, tuple[int, int]]:
    """Per man: (marks with a raw box within `HIT_YARDS` in that frame, marks)."""
    out = {}
    for name, marks in truth["men"].items():
        hits = 0
        for k, (gx, gy) in marks.items():
            f = int(k)
            hits += f < len(spots) and any(np.hypot(x - gx, y - gy) <= HIT_YARDS for x, y in spots[f])
        out[name] = (hits, len(marks))
    return out


def score(tracks: dict, truth: dict) -> tuple[int, int, list[str]]:
    fps = tracks["fps"]
    offense = [t for t in tracks["tracks"] if t["team"] == "offense" and t["points"]]
    right = total = 0
    lines = []
    for name, marks in truth["men"].items():
        frames = sorted((int(k), v) for k, v in marks.items())

        def at(t, f: int):
            near = [(abs(round(s * fps) - f), x, y) for s, x, y in t["points"] if abs(round(s * fps) - f) <= NEAR_FRAMES]
            return min(near)[1:] if near else None

        # His track: the one on him (within `HIT_YARDS`) at the first of his marks where any track is. A mark in a gap (the
        # detector missed him that frame) doesn't hand him to whatever track happens to be nearest, yards away.
        own, start = None, len(frames)
        for i, (f, (gx, gy)) in enumerate(frames):
            on = [(float(np.hypot(p[0] - gx, p[1] - gy)), t) for t in offense if (p := at(t, f)) is not None]
            on = [q for q in on if q[0] <= HIT_YARDS]
            if on:
                own, start = min(on, key=lambda q: q[0])[1], i
                break
        # Every mark after the first is scored, as before: the ones before he is pinned are missing, the pinning one (when it
        # isn't the first) is right.
        row = [f"{f}:missing" for f, _ in frames[1:start]]
        total += min(start, len(frames)) - 1 if start > 0 else 0
        if own is not None and start > 0:
            row.append(f"{frames[start][0]}:right")
            right += 1
            total += 1
        for f, (gx, gy) in frames[max(start, 0) + 1 :] if own is not None else []:
            total += 1
            p = at(own, f)
            if p is None:
                row.append(f"{f}:missing")
                continue
            hit = np.hypot(p[0] - gx, p[1] - gy) <= HIT_YARDS
            right += hit
            row.append(f"{f}:{'right' if hit else 'wrong'}")
        lines.append(f"{name}: " + " ".join(row))
    return right, total, lines


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tracks", type=Path)
    ap.add_argument("truth", type=Path)
    ap.add_argument("--dump", type=Path, help="the run's saved detections: also say how often the detector found each man")
    ap.add_argument("--calibration", type=Path, help="a better calibration of the dump's frame (the clip's .json)")
    args = ap.parse_args()
    tracks = json.loads(args.tracks.read_text())
    truth = json.loads(args.truth.read_text())
    right, total, lines = score(tracks, truth)
    print(f"{right} of {total} marks on the man's own track")
    seen = None
    if args.dump:
        dump = json.loads(args.dump.read_text())
        if args.calibration:
            from .label import with_calibration

            dump = with_calibration(dump, json.loads(args.calibration.read_text()))
        seen = found(raw_spots(dump), truth)
        print(f"{sum(h for h, _ in seen.values())} of {sum(n for _, n in seen.values())} marks with a detector box on the man")
    for line in lines:
        name = line.split(":")[0]
        print("  " + line + (f"   (detector found him at {seen[name][0]} of {seen[name][1]} marks)" if seen else ""))


if __name__ == "__main__":
    main()

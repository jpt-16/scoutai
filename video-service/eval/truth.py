"""How often a tracks file has each man on his own track, against positions marked by hand.

    python -m eval.truth tracks/play_05.json eval/truth/play_05.json [--dump detections/play_05_detections.json [--calibration play_05.json]]

Route names say whether the whole chain worked; this says whether the tracker did. A truth file marks where each
receiver really was at a few frames (yards from the ball, offense's view; see `truth/play_05.json`). His track is
the one nearest his first mark at that frame; a later mark counts as right when that track is within `HIT_YARDS` of it
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
        (_, (x0, y0)), later = frames[0], frames[1:]
        f0 = frames[0][0]

        def gap_at_first(t) -> float:
            # Where the track was at his first mark (a track may start after frame 0: `boxtrack.SEED_FRAMES`); a track not there
            # then is scored by where it started, behind every track that was.
            near = [np.hypot(x - x0, y - y0) for s, x, y in t["points"] if abs(round(s * fps) - f0) <= NEAR_FRAMES]
            return min(near) if near else 1000 + float(np.hypot(t["points"][0][1] - x0, t["points"][0][2] - y0))

        own = min(offense, key=gap_at_first)
        row = []
        for f, (gx, gy) in later:
            total += 1
            near = [(abs(round(s * fps) - f), x, y) for s, x, y in own["points"] if abs(round(s * fps) - f) <= NEAR_FRAMES]
            if not near:
                row.append(f"{f}:missing")
                continue
            _, x, y = min(near)
            hit = np.hypot(x - gx, y - gy) <= HIT_YARDS
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

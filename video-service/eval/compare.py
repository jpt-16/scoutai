"""Puts two detection dumps of the same clip side by side (`--detections`), so a change to the detector can be measured.

    python -m eval.compare detections_tiles/play_03_detections.json detections_region/play_03_detections.json

For each, by how far the camera had zoomed out since the snap: people found per frame (detector score over 0.5),
how many of them are small (under 50 pixels tall), and how many survive the tracker's filters; then each offensive
track's share of the play's frames.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

BANDS = [(0.0, 1.1), (1.1, 1.3), (1.3, 1.5), (1.5, 9.0)]


def zoom(m: list[list[float]]) -> float:
    a = np.array(m, dtype=np.float64)
    return float(np.sqrt(abs(np.linalg.det(a[:2, :2]) / a[2, 2])))


def summary(dump: dict) -> list[str]:
    z = np.array([zoom(m) for m in dump["to_snap"]])
    found = np.array([sum(r["score"] > 0.5 for r in raw) for raw in dump["raw"]])
    small = np.array([sum(r["score"] > 0.5 and r["box"][3] - r["box"][1] < 50 for r in raw) for raw in dump["raw"]])
    kept = np.array([len(f) for f in dump["frames"]])
    lines = []
    for lo, hi in BANDS:
        m = (z >= lo) & (z < hi)
        if m.any():
            lines.append(
                f"  zoom {lo:.1f}-{hi if hi < 9 else 'up':>3}: {m.sum():3d} frames, found {found[m].mean():5.1f} a frame"
                f" ({small[m].mean():4.1f} small), kept {kept[m].mean():4.1f}"
            )
    n = len(dump["frames"])
    shares = sorted((len(t["matched"]) / n for t in dump["tracks"] if t["team"] == "offense"), reverse=True)
    lines.append("  offense tracks, share of frames: " + " ".join(f"{s:.0%}" for s in shares))
    return lines


def main() -> None:
    for path in sys.argv[1:]:
        print(path)
        for line in summary(json.loads(Path(path).read_text())):
            print(line)


if __name__ == "__main__":
    main()

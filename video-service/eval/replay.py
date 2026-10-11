"""Replays the post-detector half of the pipeline from a saved dump (`--detections`), without the film or the detector.

    python -m eval.replay detections/play_03_detections.json

Re-runs the filters (officials, bench, sideline, duplicates) and the tracker on the saved raw boxes, so a change to either
can be tried right away and compared with what the Mac produced. Returns the same `tracks` structure `track_play` writes.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from geometry import CalibrationPoints, build_homography

from .people import feet_locator
from .tracks import drop_standing_weak, follow, people_on_the_field, track_play  # noqa: F401


def replay(dump: dict) -> dict:
    calibration = dump["calibration"]
    calib = build_homography(CalibrationPoints(source=calibration["source"], destination=calibration["destination"]))
    locate = feet_locator(calib)
    ball = tuple(dump["ball"])
    direction = dump["direction"]
    to_snap = [np.array(m, dtype=np.float64) for m in dump["to_snap"]]
    kept_boxes, per_frame, colors, weak = [], [], [], []
    for i, raw in enumerate(dump["raw"]):
        boxes = [(*r["box"], r["score"]) for r in raw]
        info = [(tuple(r["color"]), r["official"]) for r in raw]
        kb, pos, col, wk = people_on_the_field(None, boxes, to_snap[i], locate, ball, direction, info)  # type: ignore[arg-type]
        kept_boxes.append(kb)
        per_frame.append(pos)
        colors.append(col)
        weak.append(wk)
    drop_standing_weak(per_frame, kept_boxes, colors, weak)
    tracks = follow(per_frame[0], per_frame, colors)
    return {"per_frame": per_frame, "colors": colors, "tracks": tracks, "boxes": kept_boxes}


def main() -> None:
    dump = json.loads(Path(sys.argv[1]).read_text())
    out = replay(dump)
    print(f"{len(out['tracks'])} tracks; people per frame (every 15): {[len(f) for f in out['per_frame'][::15]]}")


if __name__ == "__main__":
    main()

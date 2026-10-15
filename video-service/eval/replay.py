"""Replays the post-detector half of the pipeline from a saved dump (`--detections`), without the film or the detector.

    python -m eval.replay detections/play_03_detections.json [boxes|greedy|tracklets]

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
from .tracks import TRACKER, follow_two_pass, drop_standing_sideline, drop_standing_weak, trim_at_sideline, follow, people_on_the_field, track_play  # noqa: F401


def replay(dump: dict, tracker: str = TRACKER, signatures_from=None, labels_for=None, shares_from=None) -> dict:
    """`tracker="tracklets"` needs each raw box's jersey signature: the dump's "jersey" (written since the tracklet tracker
    came in), or `signatures_from(frame, box)` for an older dump replayed beside its film. `labels_for(frame, spots)` names
    each person offense / defense for the frame-to-frame trackers (`tracks.team_by_jersey` against the film's frames); without it all
    are offense. The "boxes" tracker's jersey gate uses each raw box's "share" of the scouted team's color (written when the run had
    one), or `shares_from(frame, box)` beside the film; with neither, it runs without the gate."""
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
    drop_standing_sideline(per_frame, kept_boxes, colors, ball[0], direction)
    signatures = None
    if tracker == "tracklets":
        signatures = []
        for f, kept in enumerate(kept_boxes):
            jersey = {tuple(r["box"]): r.get("jersey") for r in dump["raw"][f]}
            signatures.append(
                [
                    np.array(jersey[tuple(b[:4])], dtype=np.float32)
                    if jersey.get(tuple(b[:4])) is not None
                    else signatures_from(f, b)  # type: ignore[misc]
                    for b in kept
                ]
            )
    warped = shares = None
    if tracker == "boxes":
        from .boxtrack import warp_boxes

        warped = [warp_boxes(kept, to_snap[f]) for f, kept in enumerate(kept_boxes)]
        from .scoutteam import worn_share

        scouted = str(dump.get("scout_color") or "")
        saved = [
            {
                tuple(r["box"]): None if r.get("share") is None else worn_share(scouted, r["share"], r["jersey"][0] if r.get("jersey") else None)
                for r in raw
            }
            for raw in dump["raw"]
        ]
        if all(v is not None for frame in saved for v in frame.values()) and any(saved):
            shares = [[saved[f][tuple(b[:4])] for b in kept] for f, kept in enumerate(kept_boxes)]
        elif shares_from is not None:
            shares = [[shares_from(f, b) for b in kept] for f, kept in enumerate(kept_boxes)]
    from .tracks import snap_pixel_to_yards

    from .scoutteam import wear_gate

    tracks, labels = follow_two_pass(
        per_frame, colors, tracker, dump.get("fps", 30.0), signatures, labels_for, warped, shares, snap_pixel_to_yards(calib, ball, direction),
        wear_gate(str(dump.get("scout_color") or "")) if shares else None,
    )
    trim_at_sideline(tracks, ball[0], direction)
    return {"per_frame": per_frame, "colors": colors, "tracks": tracks, "labels": labels, "boxes": kept_boxes}


def main() -> None:
    dump = json.loads(Path(sys.argv[1]).read_text())
    out = replay(dump, sys.argv[2] if len(sys.argv) > 2 else TRACKER)
    print(f"{len(out['tracks'])} tracks; people per frame (every 15): {[len(f) for f in out['per_frame'][::15]]}")


if __name__ == "__main__":
    main()

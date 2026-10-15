"""Numbered pictures of one play, so each receiver's track can be checked against where he really went.

    python -m eval.label detections/play_34_detections.json clips/play_34.mp4 --start 180 --out label/

`--start` is the clip's calibrated frame (the file's `frame`). Replays the tracker from the saved dump (no GPU), then draws the
offense's men, each in his track's color with a big number, at four moments: the set, the snap, 1.5 s and 3 s after it, with
1.5 s of trail behind each, in one contact sheet (`label/<clip>_men.jpg`). Reading it, someone who saw the play says which number
is which receiver and whether the number stays on the same man from picture to picture; a swap shows as a trail that jumps
from one man to another. Writes `label/<clip>_men.txt` too: each offense track's id, where it started, and how long it lasts.

`--calibration clip.json` replays with a better calibration than the run had (the camera and the detections don't depend on it), and
`--tracks tracks/` writes the replayed play as a normal tracks file (`tracks/<clip>.json`) for `scripts/tracks-to-cards.ts`: a
calibration fixed after the GPU run reaches the cards with no new detector run.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from .field import upright
from .replay import replay
from geometry import CalibrationPoints, build_homography, transform_point

from .tracks import TRACKER, snap_seconds, team_by_jersey, tracks_result
from .trackdebug import TRAIL_SECONDS, _foot, _in_frame, track_color

MOMENTS = (None, 0.0, 1.5, 3.0)  # None = the first frame; the rest are seconds after the snap
SHEET_WIDTH = 2400


def play_tracks(dump: dict, frames: list[np.ndarray], scout_color: str = "red", tracker: str = TRACKER) -> dict:
    """The replayed tracker with offense / defense named from the film's jersey colors."""
    from .scoutteam import COLORS, color_share

    kept = replay(dump, "greedy")["boxes"]

    def labels_for(k: int, spots):
        return team_by_jersey(frames[k], kept[k], spots, scout_color)

    def shares_from(k: int, box):
        return color_share(frames[k], box, scout_color)

    return replay(dump, tracker, None, labels_for, shares_from if scout_color in COLORS else None)


def with_calibration(dump: dict, cal: dict) -> dict:
    """The dump with another calibration of the same frame (a clip's .json): the field, the ball and the direction."""
    cal = upright(cal)
    calib = build_homography(CalibrationPoints(source=cal["source"], destination=cal["destination"]))
    ball = transform_point(calib, *cal["ball"])
    calibration = {**cal, "frame": dump["calibration"].get("frame", 0)}
    return {**dump, "calibration": calibration, "ball": [float(ball[0]), float(ball[1])], "direction": int(cal["direction"])}


def picture(frame, boxes, tracks, labels, k: int, fps: float, to_snap, title: str):
    img = frame.copy()
    by_person = {}
    for t in tracks:
        for f, j in t.matched:
            if f == k:
                by_person[j] = t.id
    trail_from = k - int(TRAIL_SECONDS * fps)
    for t in tracks:
        if labels[t.id] != "offense":
            continue
        color = track_color(t.id)
        pts = [
            _in_frame(_foot(boxes[f][j]), f, k, to_snap)
            for f, j in t.matched
            if trail_from <= f <= k and f < len(boxes) and j < len(boxes[f])
        ]
        for a, b in zip(pts, pts[1:]):
            cv2.line(img, a, b, color, 3)
    for j, box in enumerate(boxes[k]):
        t_id = by_person.get(j)
        if t_id is None or labels[t_id] != "offense":
            continue
        x1, y1, x2, y2 = (int(v) for v in box[:4])
        color = track_color(t_id)
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 3)
        cv2.putText(img, str(t_id), (x1, max(26, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (0, 0, 0), 6, cv2.LINE_AA)
        cv2.putText(img, str(t_id), (x1, max(26, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 1.1, color, 2, cv2.LINE_AA)
    cv2.putText(img, title, (12, 34), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 5, cv2.LINE_AA)
    cv2.putText(img, title, (12, 34), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2, cv2.LINE_AA)
    return img


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dump", type=Path)
    ap.add_argument("clip", type=Path)
    ap.add_argument("--start", type=int, required=True, help="the clip's calibrated frame")
    ap.add_argument("--out", type=Path, default=Path("label"))
    ap.add_argument("--scout-color", default="red", help="the jersey color of the team being scouted")
    ap.add_argument("--calibration", type=Path, help="a better calibration of the same frame (the clip's .json): replaces the dump's")
    ap.add_argument("--tracks", type=Path, help="also write the replayed play here as a tracks file (<clip>.json)")
    args = ap.parse_args()
    dump = json.loads(args.dump.read_text())
    if args.calibration:
        dump = with_calibration(dump, json.loads(args.calibration.read_text()))
    cap = cv2.VideoCapture(str(args.clip))
    cap.set(cv2.CAP_PROP_POS_FRAMES, args.start)
    frames = [cap.read()[1] for _ in range(len(dump["raw"]))]
    out = play_tracks(dump, frames, args.scout_color)
    fps = dump.get("fps", 30.0)
    tracks, labels, boxes = out["tracks"], out["labels"], out["boxes"]
    to_snap = [np.array(m) for m in dump["to_snap"]]
    as_json = [
        {"team": labels[t.id], "points": [[f / fps, x, y] for f, x, y in t.points]} for t in tracks if len(t.points) >= 2
    ]
    snap = snap_seconds(as_json)
    shots = []
    for m in MOMENTS:
        k = 0 if m is None else min(len(frames) - 1, int(round((snap + m) * fps)))
        title = "the set" if m is None else ("the snap" if m == 0 else f"snap +{m:g}s")
        shots.append(picture(frames[k], boxes, tracks, labels, k, fps, to_snap, f"{args.clip.stem}: {title} (t={k / fps:.1f}s)"))
    args.out.mkdir(parents=True, exist_ok=True)
    cell_w = SHEET_WIDTH // 2
    cells = [cv2.resize(s, (cell_w, int(s.shape[0] * cell_w / s.shape[1]))) for s in shots]
    sheet = np.vstack([np.hstack(cells[:2]), np.hstack(cells[2:])])
    cv2.imwrite(str(args.out / f"{args.clip.stem}_men.jpg"), sheet, [cv2.IMWRITE_JPEG_QUALITY, 88])
    lines = [f"snap at {snap:.2f}s"]
    for t in tracks:
        if labels[t.id] != "offense" or len(t.points) < 2:
            continue
        lines.append(f"track {t.id}: starts ({t.points[0][1]:+.1f}, {t.points[0][2]:+.1f}) yd at {t.points[0][0] / fps:.1f}s, lasts to {t.points[-1][0] / fps:.1f}s")
    (args.out / f"{args.clip.stem}_men.txt").write_text("\n".join(lines))
    if args.tracks:
        from .scoutteam import COLORS, scout_side

        color = args.scout_color.strip().lower()
        scout = None
        if color in COLORS:
            first = {j: t.id for t in tracks for f, j in t.matched if f == 0}
            side = {lab: [b for j, b in enumerate(boxes[0]) if j in first and labels[first[j]] == lab] for lab in ("offense", "defense")}
            scout = {"color": color, "side": scout_side(frames[0], side["offense"], side["defense"], color)}
        args.tracks.mkdir(parents=True, exist_ok=True)
        (args.tracks / f"{args.clip.stem}.json").write_text(json.dumps(tracks_result(tracks, labels, out["colors"], fps, scout)))
    print("\n".join(lines))


if __name__ == "__main__":
    main()

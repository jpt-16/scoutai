"""Follows every player through a play and writes where each one went, in yards.

    python -m eval.tracks clips/ --out tracks/

This is the step after the pre-snap read (`presnap.py`) and before the route reader
(`scripts/read-routes.ts`). Same calibration file per clip (`eval.calibrate`: the snap
frame, four field spots, the ball, which way the offense goes). The hard part is that the
camera moves: it pans and zooms with the play, so a player's pixel position says almost
nothing. Two things make it work:

 1. **Hold the camera still, on paper.** Each frame is matched to the one before it on the
    background (the field, with the players masked out), and the matches are chained back
    to the snap frame, so every frame's pixels can be put onto the snap frame's, and from
    there onto the field through the calibration (`camera_to_snap`).
 2. **Follow people on the field, not the screen.** Once positions are in yards a player
    moves a few feet between frames and the tracker only has to pair each person with the
    nearest one it just saw (`follow`).

Output per clip is `tracks/<clip>.json`: for each player seen at the snap, his team and his
path in yards from the ball, in the offense's own view (x to its right, y upfield). Then
`npx jiti scripts/read-routes.ts tracks/play_01.json` names each offensive player's route.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from geometry import CalibrationPoints, build_homography, transform_point

from .teams import pick_offense, two_means

Box = tuple[float, float, float, float, float]  # x1, y1, x2, y2, score

# A person moves at most this far (yards) between two frames and is still the same person.
MAX_STEP_YARDS = 1.6
# A track missing for this many frames is dropped.
MAX_MISSED = 12
MIN_MATCHES = 25


def _mask_without(boxes: list[Box], shape: tuple[int, int]) -> np.ndarray:
    """Where to look for background features: everywhere except the people (and a margin)."""
    mask = np.full(shape, 255, np.uint8)
    for x1, y1, x2, y2, _ in boxes:
        pad_x, pad_y = 0.3 * (x2 - x1), 0.15 * (y2 - y1)
        cv2.rectangle(
            mask,
            (int(max(0, x1 - pad_x)), int(max(0, y1 - pad_y))),
            (int(min(shape[1] - 1, x2 + pad_x)), int(min(shape[0] - 1, y2 + pad_y))),
            0,
            -1,
        )
    return mask


def frame_to_previous(prev_gray, gray, prev_boxes: list[Box], boxes: list[Box]) -> np.ndarray | None:
    """3x3 matrix taking this frame's pixels onto the previous frame's, from the field itself."""
    orb = cv2.ORB_create(nfeatures=2500, fastThreshold=8)
    kp1, d1 = orb.detectAndCompute(prev_gray, _mask_without(prev_boxes, prev_gray.shape))
    kp2, d2 = orb.detectAndCompute(gray, _mask_without(boxes, gray.shape))
    if d1 is None or d2 is None or len(kp1) < MIN_MATCHES or len(kp2) < MIN_MATCHES:
        return None
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(d2, d1, k=2)
    good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.75 * n.distance]
    if len(good) < MIN_MATCHES:
        return None
    src = np.float32([kp2[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kp1[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    h, inliers = cv2.findHomography(src, dst, cv2.RANSAC, 3.0)
    if h is not None and inliers is not None and int(inliers.sum()) >= MIN_MATCHES:
        return h
    # A pan and a zoom are a similarity; settle for that when a full homography won't fit.
    affine, inliers = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=3.0)
    if affine is not None and inliers is not None and int(inliers.sum()) >= MIN_MATCHES:
        return np.vstack([affine, [0, 0, 1]])
    return None


def camera_to_snap(
    grays: list[np.ndarray], boxes: list[list[Box]], snap: int
) -> list[np.ndarray]:
    """For each frame from `snap` on: the matrix taking its pixels onto the snap frame's."""
    out = [np.eye(3)]
    for i in range(snap + 1, len(grays)):
        step = frame_to_previous(grays[i - 1], grays[i], boxes[i - 1], boxes[i])
        # No match (a blur, a wipe): hold the camera where it was rather than guess.
        out.append(out[-1] @ (step if step is not None else np.eye(3)))
    return out


@dataclass
class Track:
    id: int
    start: tuple[float, float]
    points: list[tuple[int, float, float]] = field(default_factory=list)  # frame, x, y (yards)
    missed: int = 0

    @property
    def last(self) -> tuple[float, float]:
        return self.points[-1][1], self.points[-1][2]

    def predicted(self) -> tuple[float, float]:
        """Where he'd be if he kept going the way he was (a person doesn't turn on a dime)."""
        if len(self.points) < 2:
            return self.last
        (_, x0, y0), (_, x1, y1) = self.points[-2], self.points[-1]
        return x1 + (x1 - x0), y1 + (y1 - y0)


def follow(seen_at_snap: list[tuple[float, float]], per_frame: list[list[tuple[float, float]]]) -> list[Track]:
    """Pairs people across frames, nearest first. `per_frame[0]` is the snap frame."""
    tracks = [Track(i, p, [(0, p[0], p[1])]) for i, p in enumerate(seen_at_snap)]
    for f, people in enumerate(per_frame[1:], start=1):
        free = set(range(len(people)))
        pairs = sorted(
            (np.hypot(people[j][0] - t.predicted()[0], people[j][1] - t.predicted()[1]), ti, j)
            for ti, t in enumerate(tracks)
            if t.missed <= MAX_MISSED
            for j in free
        )
        taken: set[int] = set()
        for dist, ti, j in pairs:
            t = tracks[ti]
            if ti in taken or j not in free or dist > MAX_STEP_YARDS * (1 + t.missed):
                continue
            t.points.append((f, people[j][0], people[j][1]))
            t.missed = 0
            taken.add(ti)
            free.discard(j)
        for ti, t in enumerate(tracks):
            if ti not in taken:
                t.missed += 1
    return tracks


def to_yards(
    box: Box, to_snap: np.ndarray, calib: np.ndarray, ball: tuple[float, float], direction: int
) -> tuple[float, float]:
    """A person's feet, put on the snap frame, then on the field, then in the offense's own view."""
    foot = cv2.perspectiveTransform(np.float32([[[(box[0] + box[2]) / 2, box[3]]]]), to_snap)[0, 0]
    fx, fy = transform_point(calib, float(foot[0]), float(foot[1]))
    return (fx - ball[0]) * direction, (fy - ball[1]) * direction


def track_play(
    frames_bgr: list[np.ndarray],
    boxes: list[list[Box]],
    calibration: dict,
    team_of: "callable",
    fps: float,
) -> dict:
    """The tracks for one play. `boxes[i]` are the people found in frame `i`; frame `calibration['frame']` is the snap."""
    snap = calibration["frame"]
    direction = calibration["direction"]
    calib = build_homography(CalibrationPoints(source=calibration["source"], destination=calibration["destination"]))
    ball = transform_point(calib, *calibration["ball"])
    grays = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames_bgr]
    to_snap = camera_to_snap(grays, boxes, snap)

    per_frame = [
        [to_yards(b, to_snap[i - snap], calib, ball, direction) for b in boxes[i]] for i in range(snap, len(grays))
    ]
    snap_boxes = boxes[snap]
    tracks = follow(per_frame[0], per_frame)
    labels = team_of(frames_bgr[snap], snap_boxes, per_frame[0])
    return {
        "fps": fps,
        "tracks": [
            {
                "id": t.id,
                "team": labels[t.id],
                "start": [round(t.start[0], 2), round(t.start[1], 2)],
                "points": [[round(f / fps, 3), round(x, 2), round(y, 2)] for f, x, y in t.points],
            }
            for t in tracks
        ],
    }


def team_by_jersey(frame: np.ndarray, boxes: list[Box], spots: list[tuple[float, float]]) -> list[str]:
    """Offense or defense for each person at the snap: the group lined up behind the other."""
    from .presnap import torso_color

    labels = two_means([torso_color(frame, b) for b in boxes])
    if not boxes:
        return []
    offense = pick_offense(labels, [y for _, y in spots])
    return ["offense" if label == offense else "defense" for label in labels]


def track_clip(clip: Path, detector, seconds: float = 6.0, tiles: int = 2) -> dict:
    """Follows everyone through one clip, from the calibration file beside it."""
    calibration = json.loads(clip.with_suffix(".json").read_text())
    cap = cv2.VideoCapture(str(clip))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cap.set(cv2.CAP_PROP_POS_FRAMES, calibration["frame"])
    frames: list[np.ndarray] = []
    for _ in range(int(seconds * fps) + 1):
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(frame)
    # Frame 0 of the list is the snap frame the calibration was made on.
    calibration = {**calibration, "frame": 0}
    boxes = [detector.people(f, tiles) for f in frames]
    return track_play(frames, boxes, calibration, team_by_jersey, fps)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("clips", type=Path, help="folder of clips with a calibration .json beside each (eval.calibrate)")
    ap.add_argument("--out", type=Path, default=Path("tracks"))
    ap.add_argument("--seconds", type=float, default=6.0, help="how long after the snap to follow")
    ap.add_argument("--tiles", type=int, default=2)
    args = ap.parse_args()

    from .presnap import Detector

    detector = Detector()
    args.out.mkdir(parents=True, exist_ok=True)
    for clip in sorted(p for p in args.clips.iterdir() if p.suffix.lower() in {".mp4", ".mov", ".m4v"}):
        if not clip.with_suffix(".json").exists():
            continue
        result = track_clip(clip, detector, args.seconds, args.tiles)
        (args.out / f"{clip.stem}.json").write_text(json.dumps(result))
        n_off = sum(t["team"] == "offense" for t in result["tracks"])
        print(f"{clip.name}: {len(result['tracks'])} people followed, {n_off} offense")


if __name__ == "__main__":
    main()

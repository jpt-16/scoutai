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

from . import field as fieldmod
from .officials import looks_like_official
from .people import EDGE_YARDS, FIELD_WIDTH, SHORT_EDGE_YARDS, feet_locator, on_the_field
from .teams import split_teams

Box = tuple[float, float, float, float, float]  # x1, y1, x2, y2, score

# A person is within this many yards of where his track says he is, from one frame to the next. A sprint is
# about a third of a yard a frame, but the detector's boxes jitter (a far player's feet move a yard when
# his box shifts a few pixels), so this is not a tight limit: one at half a yard threw away real receivers.
MAX_STEP_YARDS = 0.8
# A man the detector misses for some frames may be further from where he was last seen, by about what a
# runner covers in a frame and its error, up to a ceiling: a track allowed to jump anywhere grabs the
# nearest of the bench (the first tracker allowed 4.8 yd from the first missed frame; this takes a few frames to get there).
MISSED_GROWTH_YARDS = 0.2
MAX_RADIUS_YARDS = 6.0
# A man's speed is read over this many of his last matches (two frames' jitter says nothing about speed) and
# can't be more than this many yards a frame (a sprint is about 0.35).
VELOCITY_FRAMES = 6
MAX_YARDS_PER_FRAME = 0.45
# Frames of a recording that stop changing (the Hudl player froze at the end of the clip) carry no play.
FROZEN_FRAME_DIFF = 0.05
FROZEN_FRAMES = 8
# People further than this from the ball (yards) are the crowd.
MAX_DEPTH = 25.0
# Two detections this close together (yards) are one person seen twice.
SAME_PERSON_YARDS = 0.4
# Below this much paint (summed over a half-size frame) the paint can't hold the camera still.
MIN_PAINT = 150.0
# A track missing for this many frames is dropped.
MAX_MISSED = 45
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


def _paint_image(frame_bgr: np.ndarray) -> np.ndarray:
    """The field's painted lines on a half-size frame, softened: what the camera is held against."""
    small = cv2.resize(frame_bgr, (frame_bgr.shape[1] // 2, frame_bgr.shape[0] // 2), interpolation=cv2.INTER_AREA)
    return cv2.GaussianBlur(fieldmod.paint_mask(small).astype(np.float32) / 255.0, (0, 0), 2.5)


# The camera moves smoothly; the error in lining each frame up with the snap frame is independent from
# frame to frame. Smoothing the camera over about a tenth of a second removes that jitter, which would
# otherwise look like every player trembling a quarter of a yard.
CAMERA_SMOOTHING_FRAMES = 3.0


def smooth_cameras(matrices: list[np.ndarray], size: tuple[int, int], sigma: float = CAMERA_SMOOTHING_FRAMES) -> list[np.ndarray]:
    """The same camera path with its frame-to-frame jitter taken out: where each frame's four corners land on
    the snap frame, smoothed over time, and a matrix refitted to the smoothed corners."""
    if len(matrices) < 3 or sigma <= 0:
        return matrices
    w, h = size
    corners = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    path = np.array([cv2.perspectiveTransform(corners.reshape(1, -1, 2), m).reshape(-1, 2) for m in matrices])
    radius = int(3 * sigma)
    kernel = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma) ** 2)
    kernel /= kernel.sum()
    padded = np.concatenate([path[radius:0:-1], path, path[-2 : -radius - 2 : -1]], axis=0)
    smooth = np.stack(
        [np.convolve(padded[:, c, d], kernel, mode="valid") for c in range(4) for d in range(2)], axis=1
    ).reshape(len(matrices), 4, 2)
    return [cv2.getPerspectiveTransform(corners, smooth[i].astype(np.float32)).astype(np.float64) for i in range(len(matrices))]


def camera_to_snap_paint(frames_bgr: list[np.ndarray]) -> list[np.ndarray] | None:
    """For each frame (the first is the snap frame): the matrix taking its pixels onto the snap frame's,
    found by lining the field's painted lines up with the snap frame's directly (ECC, a homography fitted
    to the two paint pictures), each time starting from where the last frame landed. Registering every
    frame straight to the snap frame, not frame to frame, means errors don't add up over the play: on a
    real clip the camera pans 400 yards-worth of pixels in five seconds, and a chain of frame-to-frame
    matches drifted by a quarter of that, this by a fraction. None if there is too little paint to hold
    onto, and the caller falls back to `camera_to_snap`."""
    paint = [_paint_image(f) for f in frames_bgr]
    if not paint or float(paint[0].sum()) < MIN_PAINT:
        return None
    down, up = np.diag([0.5, 0.5, 1.0]), np.diag([2.0, 2.0, 1.0])
    out = [np.eye(3)]
    h = np.eye(3, dtype=np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-5)
    for p in paint[1:]:
        try:
            _, h = cv2.findTransformECC(paint[0], p, h.copy(), cv2.MOTION_HOMOGRAPHY, criteria, None, 5)
        except cv2.error:
            pass  # no fit on this frame (a blur): hold the camera where it was
        out.append(up @ np.linalg.inv(h) @ down)
    return smooth_cameras(out, (frames_bgr[0].shape[1], frames_bgr[0].shape[0]))


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
    matched: list[tuple[int, int]] = field(default_factory=list)  # frame, index of the person in that frame (for pictures)
    missed: int = 0
    color: tuple[float, float, float] | None = None  # his jersey, as it has looked so far

    @property
    def last(self) -> tuple[float, float]:
        return self.points[-1][1], self.points[-1][2]

    def predicted(self, ahead: int = 1) -> tuple[float, float]:
        """Where he'd be `ahead` frames after he was last seen if he kept going the way he was (a person
        doesn't turn on a dime). A man missed for a few frames has gone on that many frames further."""
        if len(self.points) < 2:
            return self.last
        (f0, x0, y0), (f1, x1, y1) = self.points[-1 - min(VELOCITY_FRAMES, len(self.points) - 1)], self.points[-1]
        gap = max(1, f1 - f0)
        vx, vy = (x1 - x0) / gap, (y1 - y0) / gap
        speed = float(np.hypot(vx, vy))
        if speed > MAX_YARDS_PER_FRAME:
            vx, vy = vx * MAX_YARDS_PER_FRAME / speed, vy * MAX_YARDS_PER_FRAME / speed
        return x1 + vx * ahead, y1 + vy * ahead


# When two people cross, nearness can't tell them apart but their jerseys can: a candidate costs his
# distance (yards) plus this much per unit of Lab color difference from the jersey the track has had.
COLOR_YARDS_PER_UNIT = 0.08
COLOR_MEMORY = 0.8  # how much of a track's remembered color survives each match


def _color_gap(a: tuple[float, float, float] | None, b: tuple[float, float, float] | None) -> float:
    if a is None or b is None:
        return 0.0
    return float(np.sqrt(sum((x - y) ** 2 for x, y in zip(a, b))))


def follow(
    seen_at_snap: list[tuple[float, float]],
    per_frame: list[list[tuple[float, float]]],
    colors: list[list[tuple[float, float, float]]] | None = None,
) -> list[Track]:
    """Pairs people across frames, cheapest first (distance plus how different the jersey looks).
    `per_frame[0]` is the snap frame; `colors[f][j]` is person j's torso color in frame f."""
    tracks = [Track(i, p, [(0, p[0], p[1])], matched=[(0, i)], color=colors[0][i] if colors else None) for i, p in enumerate(seen_at_snap)]
    for f, people in enumerate(per_frame[1:], start=1):
        free = set(range(len(people)))
        pairs = sorted(
            (
                np.hypot(people[j][0] - t.predicted(t.missed + 1)[0], people[j][1] - t.predicted(t.missed + 1)[1])
                + COLOR_YARDS_PER_UNIT * _color_gap(t.color, colors[f][j] if colors else None),
                np.hypot(people[j][0] - t.predicted(t.missed + 1)[0], people[j][1] - t.predicted(t.missed + 1)[1]),
                ti,
                j,
            )
            for ti, t in enumerate(tracks)
            if t.missed <= MAX_MISSED
            for j in free
        )
        taken: set[int] = set()
        for _, dist, ti, j in pairs:
            t = tracks[ti]
            if ti in taken or j not in free or dist > min(MAX_STEP_YARDS + MISSED_GROWTH_YARDS * t.missed, MAX_RADIUS_YARDS):
                continue
            t.points.append((f, people[j][0], people[j][1]))
            t.matched.append((f, j))
            t.missed = 0
            if colors:
                new = colors[f][j]
                t.color = new if t.color is None else tuple(COLOR_MEMORY * a + (1 - COLOR_MEMORY) * b for a, b in zip(t.color, new))  # type: ignore[assignment]
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


def people_on_the_field(
    frame_bgr: np.ndarray,
    boxes: list[Box],
    to_snap: np.ndarray,
    locate,
    ball: tuple[float, float],
    direction: int,
) -> tuple[list[Box], list[tuple[float, float]], list[tuple[float, float, float]]]:
    """The people in one frame who are players: not the referees, not the bench or the sideline (a box too
    short for where its man stands is someone hidden behind others, and his head says where his feet are),
    one entry each. Returns their boxes, their positions in yards from the ball in the offense's view, and their jersey colors."""
    from .presnap import torso_color

    found: list[tuple[Box, float, float]] = []
    for b in boxes:
        if looks_like_official(frame_bgr, b):
            continue
        cx = (b[0] + b[2]) / 2
        top, bottom = cv2.perspectiveTransform(np.float32([[[cx, b[1]], [cx, b[3]]]]), to_snap)[0]
        located = (float(bottom[0]), float(top[1]), float(bottom[0]), float(bottom[1]), b[4])
        fx, fy = locate(located)
        # A man cut off by the people in front of him is placed by his head alone: only believe that well
        # inside the field (not the bench's heads along the near sideline).
        margin = SHORT_EDGE_YARDS if getattr(locate, "short", lambda _b: False)(located) else EDGE_YARDS
        if margin <= fx <= FIELD_WIDTH - margin and on_the_field(fx, fy, ball[1], MAX_DEPTH):
            found.append((b, fx, fy))
    kept: list[tuple[Box, float, float]] = []
    for item in sorted(found, key=lambda p: -p[0][4]):
        if all((item[1] - k[1]) ** 2 + (item[2] - k[2]) ** 2 > SAME_PERSON_YARDS**2 for k in kept):
            kept.append(item)
    kept.sort(key=lambda p: found.index(p))
    return (
        [k[0] for k in kept],
        [((k[1] - ball[0]) * direction, (k[2] - ball[1]) * direction) for k in kept],
        [torso_color(frame_bgr, k[0]) for k in kept],
    )


def track_play(
    frames_bgr: list[np.ndarray],
    boxes: list[list[Box]],
    calibration: dict,
    team_of: "callable",
    fps: float,
    debug: dict | None = None,
) -> dict:
    """The tracks for one play. `boxes[i]` are the people found in frame `i`; frame `calibration['frame']` is the snap."""
    snap = calibration["frame"]
    direction = calibration["direction"]
    calib = build_homography(CalibrationPoints(source=calibration["source"], destination=calibration["destination"]))
    ball = transform_point(calib, *calibration["ball"])
    # Hold the camera still: against the field's paint where there is enough of it, else its texture.
    to_snap = camera_to_snap_paint(frames_bgr[snap:])
    if to_snap is None:
        grays = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames_bgr]
        to_snap = camera_to_snap(grays, boxes, snap)
    locate = feet_locator(calib)

    kept_boxes, per_frame, colors = [], [], []
    for i in range(snap, len(frames_bgr)):
        kb, pos, col = people_on_the_field(frames_bgr[i], boxes[i], to_snap[i - snap], locate, ball, direction)
        kept_boxes.append(kb)
        per_frame.append(pos)
        colors.append(col)
    tracks = follow(per_frame[0], per_frame, colors)
    labels = team_of(frames_bgr[snap], kept_boxes[0], per_frame[0])
    if debug is not None:  # what a picture of the tracking needs
        debug.update(frames=frames_bgr[snap:], boxes=kept_boxes, tracks=tracks, labels=labels, fps=fps, to_snap=to_snap)
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

    from .officials import looks_like_official

    if not boxes:
        return []
    # Referees are neither team: leave them out of the split and call them "official".
    players = [i for i, b in enumerate(boxes) if not looks_like_official(frame, b)]
    out = ["official"] * len(boxes)
    if players:
        labels, offense = split_teams([torso_color(frame, boxes[i]) for i in players], [spots[i][1] for i in players])
        for i, label in zip(players, labels):
            out[i] = "offense" if label == offense else "defense"
    return out


def unfrozen(frames: list[np.ndarray]) -> list[np.ndarray]:
    """The frames up to where the recording stopped changing (a Hudl clip freezes on its last frame): tracking a
    still picture adds nothing, and its men would look like they stood still."""
    still = 0
    for i in range(1, len(frames)):
        a = cv2.cvtColor(frames[i - 1], cv2.COLOR_BGR2GRAY)
        b = cv2.cvtColor(frames[i], cv2.COLOR_BGR2GRAY)
        still = still + 1 if float(np.mean(cv2.absdiff(a, b))) < FROZEN_FRAME_DIFF else 0
        if still >= FROZEN_FRAMES:
            return frames[: i - FROZEN_FRAMES + 1]
    return frames


def track_clip(clip: Path, detector, seconds: float = 6.0, tiles: int = 2, debug: dict | None = None) -> dict:
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
    frames = unfrozen(frames)
    # Frame 0 of the list is the snap frame the calibration was made on.
    calibration = {**calibration, "frame": 0}
    boxes = [detector.people(f, tiles) for f in frames]
    return track_play(frames, boxes, calibration, team_by_jersey, fps, debug)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("clips", type=Path, help="folder of clips with a calibration .json beside each (eval.calibrate)")
    ap.add_argument("--out", type=Path, default=Path("tracks"))
    ap.add_argument("--seconds", type=float, default=6.0, help="how long after the snap to follow")
    ap.add_argument("--tiles", type=int, default=2)
    ap.add_argument("--debug", type=Path, default=None, help="also write pictures of the tracking here (see eval.trackdebug)")
    args = ap.parse_args()

    from .presnap import Detector

    detector = Detector()
    args.out.mkdir(parents=True, exist_ok=True)
    for clip in sorted(p for p in args.clips.iterdir() if p.suffix.lower() in {".mp4", ".mov", ".m4v"}):
        if not clip.with_suffix(".json").exists():
            continue
        debug: dict | None = {} if args.debug else None
        result = track_clip(clip, detector, args.seconds, args.tiles, debug)
        (args.out / f"{clip.stem}.json").write_text(json.dumps(result))
        n_off = sum(t["team"] == "offense" for t in result["tracks"])
        print(f"{clip.name}: {len(result['tracks'])} people followed, {n_off} offense")
        if debug is not None:
            from .trackdebug import write_pictures

            for line in write_pictures(debug, args.debug, clip.stem):
                print("  " + line)


if __name__ == "__main__":
    main()

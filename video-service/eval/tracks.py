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
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from geometry import CalibrationPoints, build_homography, transform_point

from . import field as fieldmod
from .officials import looks_like_official
from .people import EDGE_YARDS, FIELD_WIDTH, FULL_BOX_RATIO, WEAK_BOX_RATIO, SHORT_EDGE_YARDS, SIDELINE_ZONE_YARDS, feet_locator, ground_green_fraction, on_the_field, sideline_crowd, GROUND_MIN_GREEN, GROUND_ZONE_YARDS
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
# Speed is only read once a man has this many matched points, and never projected more than this many frames on.
VELOCITY_MIN_POINTS = 4
MAX_AHEAD_FRAMES = 10
MAX_YARDS_PER_FRAME = 0.45
# Frames of a recording that stop changing (the Hudl player froze at the end of the clip) carry no play.
FROZEN_FRAME_DIFF = 0.4
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
# Which tracker follows people: "greedy" (`follow`, frame to frame) or "tracklets" (`eval.tracklets`: clean pieces
# joined up, teams kept apart by their jerseys). Set per run with --tracker, or for the worker with TRACKER.
TRACKER = os.environ.get("TRACKER", "greedy")
# The jersey color of the team being scouted ("red"): each clip then says which side of the ball that team is on (`eval.scoutteam`).
SCOUT_COLOR = os.environ.get("SCOUT_COLOR", "")


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
# The paint is lined up on the half-size paint picture shrunk this many more times (see camera_to_snap_paint).
PAINT_PYRAMID = 1
PAINT_ITERATIONS = 40


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
    onto, and the caller falls back to `camera_to_snap`.

    The paint is lined up at a quarter of the frame's size (`PAINT_PYRAMID` halvings of the half-size paint
    picture): on a drawn panning, zooming clip that is 3.6x faster than half size (1.4 s against 4.9 s for
    91 frames) for 0.6 px more error (9.6 against 9.0), and a refinement at half size cost as much as not
    shrinking at all. This step ran 50-75 s a clip on Colab's CPU, the slowest part of a clip."""
    paint = [_paint_image(f) for f in frames_bgr]
    if not paint or float(paint[0].sum()) < MIN_PAINT:
        return None
    small = paint
    for _ in range(PAINT_PYRAMID):
        small = [cv2.pyrDown(p) for p in small]
    k = 2.0 * 2.0**PAINT_PYRAMID  # frame pixels per small-picture pixel
    down, up = np.diag([1 / k, 1 / k, 1.0]), np.diag([k, k, 1.0])
    out = [np.eye(3)]
    h = np.eye(3, dtype=np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, PAINT_ITERATIONS, 1e-5)
    for p in small[1:]:
        try:
            _, h = cv2.findTransformECC(small[0], p, h.copy(), cv2.MOTION_HOMOGRAPHY, criteria, None, 5)
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
        # A velocity from a frame or two is mostly the detector's box jitter (a box a few pixels shorter moves a man's
        # feet a yard): projected over a gap it sends the track off after someone else. Hold him still until he has
        # been seen in enough frames for a real speed to show.
        if len(self.points) < VELOCITY_MIN_POINTS:
            return self.last
        ahead = min(ahead, MAX_AHEAD_FRAMES)
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
# A man the tracker lost and found again may not be one whose jersey is this different (Lab units) from the one the
# track remembers: white offense against a navy defense is ~50 apart, a white jersey in shade moves ~20. Only checked when picking
# a man up after a gap, so a track that is followed frame to frame is never refused for the light changing.
COLOR_GATE = 40.0


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
            if colors and t.missed > 0 and _color_gap(t.color, colors[f][j]) > COLOR_GATE:
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
    info: list[tuple[tuple[float, float, float], bool]] | None = None,
) -> tuple[list[Box], list[tuple[float, float]], list[tuple[float, float, float]], list[bool]]:
    """The people in one frame who are players: not the referees, not the bench or the sideline (a box too
    short for where its man stands is someone hidden behind others, and his head says where his feet are),
    one entry each. Returns their boxes, their positions in yards from the ball in the offense's view, and their jersey colors.
    `info[i]` is box i's (jersey color, is an official) when it was worked out before (a saved raw dump replayed without the film)."""
    from .presnap import torso_color

    found: list[tuple[Box, float, float]] = []
    weak_of: dict[int, bool] = {}
    colors_of: dict[int, tuple[float, float, float]] = {}
    for bi, b in enumerate(boxes):
        if (info[bi][1] if info is not None else looks_like_official(frame_bgr, b)):
            continue
        cx = (b[0] + b[2]) / 2
        top, bottom = cv2.perspectiveTransform(np.float32([[[cx, b[1]], [cx, b[3]]]]), to_snap)[0]
        located = (float(bottom[0]), float(top[1]), float(bottom[0]), float(bottom[1]), b[4])
        fx, fy = locate(located)
        # A man cut off by the people in front of him is placed by his head alone: only believe that well
        # inside the field (not the bench's heads along the near sideline).
        margin = SHORT_EDGE_YARDS if getattr(locate, "short", lambda _b: False)(located) else EDGE_YARDS
        # Near a sideline, a box that doesn't show a whole man is the bench (hidden by the row in front), not a player.
        ratio = getattr(locate, "height_ratio", lambda _b: 1.0)(located)
        # Not a whole man, but more than a head: kept for now as "weak", and dropped later unless he moves (the bench
        # stands still; a receiver sprinting up the sideline, blurred and leaning, is not a whole box either).
        weak = False
        if frame_bgr is not None and min(fx, FIELD_WIDTH - fx) < GROUND_ZONE_YARDS and ground_green_fraction(frame_bgr, b) < GROUND_MIN_GREEN:
            continue  # standing on the track or bare ground beside the sideline: staff, officials, bench
        if min(fx, FIELD_WIDTH - fx) < SIDELINE_ZONE_YARDS and ratio < FULL_BOX_RATIO:
            if ratio < WEAK_BOX_RATIO:
                continue
            weak = True
        if margin <= fx <= FIELD_WIDTH - margin and on_the_field(fx, fy, ball[1], MAX_DEPTH):
            found.append((b, fx, fy))
            weak_of[id(b)] = weak
            colors_of[id(b)] = info[bi][0] if info is not None else None  # type: ignore[assignment]
    crowd = sideline_crowd([(f[1], f[2]) for f in found])
    found = [f for i, f in enumerate(found) if i not in crowd]
    kept: list[tuple[Box, float, float]] = []
    for item in sorted(found, key=lambda p: -p[0][4]):
        if all((item[1] - k[1]) ** 2 + (item[2] - k[2]) ** 2 > SAME_PERSON_YARDS**2 for k in kept):
            kept.append(item)
    kept.sort(key=lambda p: found.index(p))
    return (
        [k[0] for k in kept],
        [((k[1] - ball[0]) * direction, (k[2] - ball[1]) * direction) for k in kept],
        [colors_of[id(k[0])] if info is not None else torso_color(frame_bgr, k[0]) for k in kept],
        [weak_of[id(k[0])] for k in kept],
    )


MOVING_YARDS = 0.9
MOVING_OFFSETS = (6, 12, 18)  # frames before and after: a man starting from a stance barely moves the first 0.2 s


def drop_standing_weak(per_frame, kept_boxes, colors, weak):
    """Drops the 'weak' people (a box that isn't a whole man, near a sideline) who stay in the same place: the bench.
    One counts as moving when the nearest person to him a few frames earlier or later is more than `MOVING_YARDS` away
    (but not so far that it is someone else). Mutates and returns the lists."""
    n = len(per_frame)
    for f in range(n):
        keep = []
        for j, w in enumerate(weak[f]):
            if not w:
                keep.append(j)
                continue
            x, y = per_frame[f][j]
            moved = False
            for g in [f + sign * k for k in MOVING_OFFSETS for sign in (-1, 1)]:
                if not 0 <= g < n or not per_frame[g]:
                    continue
                nearest = min(np.hypot(x - a, y - b) for a, b in per_frame[g])
                if MOVING_YARDS <= nearest < 4.0:
                    moved = True
            if moved:
                keep.append(j)
        per_frame[f] = [per_frame[f][j] for j in keep]
        kept_boxes[f] = [kept_boxes[f][j] for j in keep]
        colors[f] = [colors[f][j] for j in keep]
        weak[f] = [False] * len(keep)
    return per_frame, kept_boxes, colors


# Standing people near a sideline are the bench, coaches and officials, not players: the first real film from a camera
# behind the bench had tracks that slid off a receiver onto them (in two of three plays, half the tracks ended on the far or
# near sideline). Calibration is a yard or two off out there, so the 3-yard edge margin lets them in.
SIDELINE_STILL_YARDS = 7.0
STILL_YARDS = 0.7  # a man who never gets this far from where he was, through a play, is standing
STILL_OFFSETS = (8, 16, 24, 40)  # frames before and after


def drop_standing_sideline(per_frame, kept_boxes, colors, ball_x: float, direction: int):
    """Drops people within `SIDELINE_STILL_YARDS` of a sideline who stay put: someone is standing when the nearest person
    a few frames before and after (to `STILL_OFFSETS`, as far as the clip goes) is within `STILL_YARDS`. A receiver standing wide
    before the snap runs a route after it, so the frames after show him move. Mutates and returns the lists."""
    n = len(per_frame)
    seen = [list(p) for p in per_frame]  # every frame as it was found: a frame already filtered would hide the standing man in it
    for f in range(n):
        keep = []
        for j, (x, y) in enumerate(per_frame[f]):
            fx = ball_x + x / direction
            if min(fx, FIELD_WIDTH - fx) >= SIDELINE_STILL_YARDS:
                keep.append(j)
                continue
            looked = 0
            still = 0
            for g in [f + sign * k for k in STILL_OFFSETS for sign in (-1, 1)]:
                if not 0 <= g < n or not seen[g]:
                    continue
                looked += 1
                nearest = min(np.hypot(x - a, y - b) for a, b in seen[g])
                if nearest <= STILL_YARDS:
                    still += 1
            if looked >= 3 and still >= looked - 1:
                continue  # standing the whole time: the bench
            keep.append(j)
        per_frame[f] = [per_frame[f][j] for j in keep]
        kept_boxes[f] = [kept_boxes[f][j] for j in keep]
        colors[f] = [colors[f][j] for j in keep]
    return per_frame, kept_boxes, colors


# The snap, from the tracks (the same rule as `trackedPlay.ts`'s `snapTime`): the fourth offensive man to move this far from his first
# spot started to, less a beat. A man in motion is one man, so he doesn't move the snap.
SNAP_MOVERS = 4
SNAP_MOVED_YARDS = 1.5
SNAP_LEAD_SECONDS = 0.35
FORMATION_NEAR_SECONDS = 0.3
FORMATION_BACK_SECONDS = 1.5


ONSET_STARTERS = 3
ONSET_WINDOW = 0.6
ONSET_STEP = 0.1
ONSET_STILL = 0.6
ONSET_GO = 1.2
ONSET_SPREAD = 0.5
ONSET_LEAD = 0.1
ONSET_LEFT = 0.5
ONSET_NEAR = 0.12
ONSET_OVERRIDE = 0.3


def _spot_at(points: list, s: float):
    p = min(points, key=lambda q: abs(q[0] - s))
    return (p[1], p[2]) if abs(p[0] - s) <= ONSET_NEAR else None


def _onset_snap(tracks: list[dict]) -> float | None:
    """The snap as an onset: three men who were standing all start within half a second (a man in motion starts once, and
    men shuffling in their stances don't get 1.2 yd from a standstill in 0.6 s). Mirrors `trackedPlay.ts`'s `onsetSnap`."""
    offense = [t for t in tracks if t["team"] == "offense" and len(t["points"]) >= 8]
    if len(offense) < ONSET_STARTERS:
        return None
    first = min(t["points"][0][0] for t in offense)
    last = max(t["points"][-1][0] for t in offense)
    onsets: list[float] = []
    for t in offense:
        s = first + ONSET_WINDOW
        while s <= last - ONSET_WINDOW:
            a, b, c = _spot_at(t["points"], s - ONSET_WINDOW), _spot_at(t["points"], s), _spot_at(t["points"], s + ONSET_WINDOW)
            if a and b and c and np.hypot(b[0] - a[0], b[1] - a[1]) < ONSET_STILL and np.hypot(c[0] - b[0], c[1] - b[1]) > ONSET_GO:
                left = next((p[0] for p in t["points"] if p[0] >= s and np.hypot(p[1] - b[0], p[2] - b[1]) > ONSET_LEFT), s)
                onsets.append(left)
                break
            s += ONSET_STEP
    onsets.sort()
    for i in range(len(onsets) - ONSET_STARTERS + 1):
        if onsets[i + ONSET_STARTERS - 1] - onsets[i] <= ONSET_SPREAD:
            return max(0.0, onsets[i] - ONSET_LEAD)
    return None


def snap_seconds(tracks: list[dict]) -> float:
    times = []
    for t in tracks:
        if t["team"] != "offense" or len(t["points"]) < 2:
            continue
        _, x0, y0 = t["points"][0]
        hit = next((p[0] for p in t["points"] if np.hypot(p[1] - x0, p[2] - y0) > SNAP_MOVED_YARDS), None)
        if hit is not None:
            times.append(hit)
    times.sort()
    older = max(0.0, times[SNAP_MOVERS - 1] - SNAP_LEAD_SECONDS) if len(times) >= SNAP_MOVERS else 0.0
    onset = _onset_snap(tracks)
    return onset if onset is not None and onset - older > ONSET_OVERRIDE else older


def formation_reads(tracks: list[dict]) -> dict:
    """The offense's formation twice: as the clip first shows it ("set") and at the snap. They differ when a man went in motion
    (Bunch, then a receiver zaps across and it is Deuces): the sheet's tag, and the card, are the formation the ball was snapped
    from, with the motion drawn from where he was set. Read from the offense's tracks (`eval.formation`)."""
    from .formation import classify, Spot

    at_snap = snap_seconds(tracks)

    def read(t0: float) -> dict:
        spots = []
        for t in tracks:
            if t["team"] != "offense" or not t["points"]:
                continue
            # Where he stood at that moment: his last spot up to `FORMATION_BACK_SECONDS` before it (a man the detector missed for
            # a moment just before the snap is still where he was), else the nearest spot just after.
            before = [p for p in t["points"] if t0 - FORMATION_BACK_SECONDS <= p[0] <= t0 + 1e-6]
            near = before[-1] if before else min(t["points"], key=lambda p: abs(p[0] - t0))
            if before or abs(near[0] - t0) <= FORMATION_NEAR_SECONDS:
                spots.append(Spot(near[1], near[2]))
        f = classify(spots)
        text = f.staff or " ".join(w for w in (f.key, f.strength or "") if w and f.key != "unknown")
        return {"key": f.key, "strength": f.strength, "staff": f.staff, "text": text, "notes": f.notes, "men": len(spots)}

    first = min((t["points"][0][0] for t in tracks if t["team"] == "offense" and t["points"]), default=0.0)
    return {"set": read(first), "snap": read(at_snap), "snapSeconds": round(at_snap, 2)}


# Seeding the tracks where the men are *separated*: a clip starts at the set, and the set can be a bunch (three men inside three yards,
# merged into a blob by the detector) or still shifting (a man zapping across). Tracks started there lose the men who matter most, and
# routes are read from the snap anyway. So the play is followed twice: once from the set (what the formation was, who went in motion)
# and once from `PRESNAP_LEAD_FRAMES` before the snap (the receivers are where they will start, apart from each other); the second's
# tracks are the play's, each with the first's pre-snap path put in front of it so the motion can still be read.
# Off by default (`TWO_PASS=1` turns it on): replayed on the first three real plays it did not score better than one pass from the set (0 of 5 and 1 of 3
# against 1 of 5 and 1 of 3), so it stays an experiment until there are more plays to measure on.
TWO_PASS = os.environ.get("TWO_PASS", "") not in ("", "0")
PRESNAP_LEAD_FRAMES = 6
MIN_SECOND_PASS_FRAMES = 12
JOIN_YARDS = 2.0


def _shift(tracks, by: int) -> None:
    for t in tracks:
        t.points = [(f + by, x, y) for f, x, y in t.points]
        t.matched = [(f + by, j) for f, j in t.matched]


def follow_two_pass(per_frame, colors, tracker: str, fps: float, signatures=None, labels_for=None):
    """(tracks, labels): the play followed from the set, then again from just before the snap (see above). `labels_for(frame, spots)`
    names each person at that frame "offense" / "defense" for the frame-to-frame tracker (the tracklet tracker names its own)."""

    def one(start: int):
        spots = per_frame[start:]
        if tracker == "tracklets":
            from .tracklets import follow_tracklets

            tracks = follow_tracklets(spots, signatures[start:], fps)  # type: ignore[index]
            labels = [t.team for t in tracks]  # type: ignore[attr-defined]
        else:
            tracks = follow(spots[0], spots, colors[start:])
            labels = labels_for(start, spots[0]) if labels_for else ["offense"] * len(tracks)
        _shift(tracks, start)
        return tracks, labels

    first, first_labels = one(0)
    if not TWO_PASS:
        return first, first_labels
    as_json = [
        {"team": first_labels[t.id], "points": [[f / fps, x, y] for f, x, y in t.points]} for t in first if len(t.points) >= 2
    ]
    k = int(round(snap_seconds(as_json) * fps)) - PRESNAP_LEAD_FRAMES
    if k < MIN_SECOND_PASS_FRAMES or k >= len(per_frame) - MIN_SECOND_PASS_FRAMES:
        return first, first_labels
    second, second_labels = one(k)
    for t in second:
        if second_labels[t.id] != "offense":
            continue
        best = None
        for a in first:
            if first_labels[a.id] != "offense":
                continue
            at = [p for p in a.points if p[0] <= k]
            if not at:
                continue
            gap = float(np.hypot(at[-1][1] - t.start[0], at[-1][2] - t.start[1])) if False else float(np.hypot(at[-1][1] - t.points[0][1], at[-1][2] - t.points[0][2]))
            if k - at[-1][0] <= 20 and gap <= JOIN_YARDS and (best is None or gap < best[0]):
                best = (gap, a)
        if best:
            before = [p for p in best[1].points if p[0] < k]
            t.points = before + t.points
            t.matched = [m for m in best[1].matched if m[0] < k] + t.matched
    return second, second_labels


# A track that runs into the 4 yards beside a sideline from inside is cut there: past it the "player" is far more often the
# bench, a coach or an official the track was handed to than a receiver (a fade ends 3-6 yards in, so its shape is kept).
SIDELINE_CUT_YARDS = 4.0


def trim_at_sideline(tracks, ball_x: float, direction: int):
    """Cuts every track at the first point where it enters the `SIDELINE_CUT_YARDS` beside a sideline from further in.
    A track that started inside that strip is left alone (it was filtered as a standing man already). Mutates and returns them."""
    for t in tracks:
        gaps = [min(fx, FIELD_WIDTH - fx) for fx in (ball_x + p[1] / direction for p in t.points)]
        for i in range(1, len(gaps)):
            if gaps[i] < SIDELINE_CUT_YARDS <= gaps[i - 1]:
                del t.points[i:]
                del t.matched[i:]
                break
    return tracks


def track_play(
    frames_bgr: list[np.ndarray],
    boxes: list[list[Box]],
    calibration: dict,
    team_of: "callable",
    fps: float,
    debug: dict | None = None,
    to_snap: list[np.ndarray] | None = None,
    tracker: str | None = None,
    scout_color: str | None = None,
) -> dict:
    """The tracks for one play. `boxes[i]` are the people found in frame `i`; frame `calibration['frame']` is the snap.
    `tracker`: "greedy" or "tracklets" (default `TRACKER`)."""
    snap = calibration["frame"]
    direction = calibration["direction"]
    calib = build_homography(CalibrationPoints(source=calibration["source"], destination=calibration["destination"]))
    ball = transform_point(calib, *calibration["ball"])
    # Hold the camera still: against the field's paint where there is enough of it, else its texture (or the
    # matrices were already worked out, from the snap frame on, because the detector needed them first).
    timing: dict[str, float] = {}
    began = time.perf_counter()
    if to_snap is None:
        to_snap = camera_to_snap_paint(frames_bgr[snap:])
        if to_snap is None:
            grays = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames_bgr]
            to_snap = camera_to_snap(grays, boxes, snap)
        timing["camera_seconds"] = time.perf_counter() - began
    began = time.perf_counter()
    locate = feet_locator(calib)

    kept_boxes, per_frame, colors, weak = [], [], [], []
    for i in range(snap, len(frames_bgr)):
        kb, pos, col, wk = people_on_the_field(frames_bgr[i], boxes[i], to_snap[i - snap], locate, ball, direction)
        kept_boxes.append(kb)
        per_frame.append(pos)
        colors.append(col)
        weak.append(wk)
    drop_standing_weak(per_frame, kept_boxes, colors, weak)
    drop_standing_sideline(per_frame, kept_boxes, colors, ball[0], direction)
    kind = tracker or TRACKER
    signatures = None
    if kind == "tracklets":
        from .tracklets import jersey_signature

        signatures = [[jersey_signature(frames_bgr[snap + f], b) for b in kept] for f, kept in enumerate(kept_boxes)]
    tracks, labels = follow_two_pass(
        per_frame, colors, kind, fps, signatures, lambda k, spots: team_of(frames_bgr[snap + k], kept_boxes[k], spots)
    )
    trim_at_sideline(tracks, ball[0], direction)
    if debug is not None:  # what a picture of the tracking needs
        debug.update(frames=frames_bgr[snap:], boxes=kept_boxes, tracks=tracks, labels=labels, fps=fps, to_snap=to_snap, per_frame=per_frame, colors=colors, raw_boxes=boxes[snap:], calibration=calibration, ball=ball, direction=direction)
    scout = None
    color = (scout_color if scout_color is not None else SCOUT_COLOR).strip().lower()
    if color:
        from .scoutteam import scout_side

        offense_boxes = [b for b, lab in zip(kept_boxes[0], labels) if lab == "offense"]
        defense_boxes = [b for b, lab in zip(kept_boxes[0], labels) if lab == "defense"]
        scout = {"color": color, "side": scout_side(frames_bgr[snap], offense_boxes, defense_boxes, color)}
    out_tracks = [
        {
            "id": t.id,
            "team": labels[t.id],
            "start": [round(t.start[0], 2), round(t.start[1], 2)],
            "points": [[round(f / fps, 3), round(x, 2), round(y, 2)] for f, x, y in t.points],
            # The jersey color (Lab L, a, b) at each point, so a swap to the other team can be seen in the numbers.
            "colors": [[round(c, 0) for c in colors[f][j]] for f, j in t.matched] if colors else [],
        }
        for t in tracks
    ]
    return {
        "fps": fps,
        "formations": formation_reads(out_tracks),
        **({"scout": scout} if scout else {}),
        "timing": {**timing, "track_seconds": round(time.perf_counter() - began, 2)},
        "tracks": out_tracks,
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
    """The frames up to where the recording stopped changing for good (a Hudl clip freezes on its last frame): tracking a
    still picture adds nothing. Video compression leaves a little noise in a frozen picture, so 'still' is a small
    average difference, and only a stillness that lasts to the end of the clip counts (a pause before the snap is not cut)."""
    last_change = 0
    for i in range(1, len(frames)):
        a = cv2.cvtColor(frames[i - 1], cv2.COLOR_BGR2GRAY)
        b = cv2.cvtColor(frames[i], cv2.COLOR_BGR2GRAY)
        if float(np.mean(cv2.absdiff(a, b))) >= FROZEN_FRAME_DIFF:
            last_change = i
    if len(frames) - 1 - last_change >= FROZEN_FRAMES:
        return frames[: last_change + 1]
    return frames


FROZEN_BOX_PIXELS = 3.0
FROZEN_SAME_FRACTION = 0.85


def frozen_from(boxes: list[list[Box]]) -> int:
    """The first frame of a tail in which the detector sees the same people in the same places (to within a couple of
    pixels) to the end of the clip: a frozen picture, whatever noise compression left in its pixels. Faint detections
    (the crowd) flicker in and out, so a frame counts as the same when nearly every box has a twin in the one before.
    The length of `boxes` if there is no such tail of at least `FROZEN_FRAMES` frames."""

    def twin(box: Box, others: list[Box]) -> bool:
        return any(all(abs(box[k] - o[k]) <= FROZEN_BOX_PIXELS for k in range(4)) for o in others)

    def same(a: list[Box], b: list[Box]) -> bool:
        if not a or not b:
            return not a and not b
        matched = sum(twin(box, b) for box in a) + sum(twin(box, a) for box in b)
        return matched >= FROZEN_SAME_FRACTION * (len(a) + len(b))

    last_change = 0
    for i in range(1, len(boxes)):
        if not same(boxes[i - 1], boxes[i]):
            last_change = i
    return last_change + 1 if len(boxes) - 1 - last_change >= FROZEN_FRAMES else len(boxes)


def track_clip(
    clip: Path,
    detector,
    seconds: float = 6.0,
    tiles: int = 2,
    debug: dict | None = None,
    region: bool = False,
    tracker: str | None = None,
    scout_color: str | None = None,
) -> dict:
    """Follows everyone through one clip, from the calibration file beside it.

    `region`: hold the camera first, then run the detector only on the field the tracker keeps people from, cut so a man is
    the same size to the model all play (`regiondetect`). Without it, the whole frame is tiled (`tiles`)."""
    timing: dict[str, float] = {}
    began = time.perf_counter()
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
    timing["read_seconds"] = time.perf_counter() - began
    # Frame 0 of the list is the snap frame the calibration was made on.
    calibration = {**calibration, "frame": 0}
    to_snap = None
    boxes = None
    if region:
        from .regiondetect import detect_play

        calib = build_homography(CalibrationPoints(source=calibration["source"], destination=calibration["destination"]))
        ball = transform_point(calib, *calibration["ball"])
        began = time.perf_counter()
        to_snap = camera_to_snap_paint(frames)
        timing["camera_seconds"] = time.perf_counter() - began
        if to_snap is not None:
            boxes = detect_play(frames, to_snap, calib, ball[1], feet_locator(calib).pixels_per_yard, detector, stats=timing)  # type: ignore[attr-defined]
    if boxes is None:  # the whole-frame tiles (also when the paint couldn't hold the camera)
        began = time.perf_counter()
        boxes = [detector.people(f, tiles) for f in frames]
        timing["detect_seconds"] = time.perf_counter() - began
        to_snap = None
    end = frozen_from(boxes)
    frames, boxes = frames[:end], boxes[:end]
    if to_snap is not None:
        to_snap = to_snap[:end]
    result = track_play(frames, boxes, calibration, team_by_jersey, fps, debug, to_snap=to_snap, tracker=tracker, scout_color=scout_color)
    result["timing"] = {k: round(v, 2) for k, v in {**timing, **result["timing"]}.items()}
    result["timing"]["frames"] = len(frames)
    return result


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("clips", type=Path, help="folder of clips with a calibration .json beside each (eval.calibrate)")
    ap.add_argument("--out", type=Path, default=Path("tracks"))
    ap.add_argument("--seconds", type=float, default=6.0, help="how long after the snap to follow")
    ap.add_argument("--tiles", type=int, default=2)
    ap.add_argument("--region", action="store_true", help="hold the camera first, then detect only on the field, with a man the same size to the model all play (see eval.regiondetect); --tiles is then unused")
    ap.add_argument("--tracker", choices=["greedy", "tracklets"], default=None, help="who follows people: greedy (frame to frame) or tracklets (eval.tracklets); default TRACKER or greedy")
    ap.add_argument("--scout-color", default=None, help="the jersey color of the team being scouted (red, blue, gold...): each play then says which side of the ball it is on; default SCOUT_COLOR")
    ap.add_argument("--debug", type=Path, default=None, help="also write pictures of the tracking here (see eval.trackdebug)")
    ap.add_argument("--detections", type=Path, default=None, help="also write everyone the detector found in every frame here, so the tracking can be tuned without the film")
    args = ap.parse_args()

    from .presnap import Detector

    detector = Detector()
    args.out.mkdir(parents=True, exist_ok=True)
    for clip in sorted(p for p in args.clips.iterdir() if p.suffix.lower() in {".mp4", ".mov", ".m4v"}):
        if not clip.with_suffix(".json").exists():
            continue
        debug: dict | None = {} if (args.debug or args.detections) else None
        result = track_clip(clip, detector, args.seconds, args.tiles, debug, args.region, args.tracker, args.scout_color)
        (args.out / f"{clip.stem}.json").write_text(json.dumps(result))
        n_off = sum(t["team"] == "offense" for t in result["tracks"])
        print(f"{clip.name}: {len(result['tracks'])} people followed, {n_off} offense")
        print("  time: " + ", ".join(f"{k.replace('_seconds', '')} {v}s" if k.endswith("_seconds") else f"{k.replace('_', ' ')} {v}" for k, v in result["timing"].items()))
        if debug is not None and args.debug:
            from .trackdebug import write_pictures

            for line in write_pictures(debug, args.debug, clip.stem):
                print("  " + line)
        if debug is not None and args.detections:
            from .trackdebug import write_detections

            print("  " + write_detections(debug, args.detections, clip.stem))


if __name__ == "__main__":
    main()

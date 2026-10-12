"""Finding the people where the play is, and showing the detector each of them at one size.

The whole-frame detector (`Detector.people(frame, tiles)`) cuts the picture into a grid and squeezes every
piece into the model's 640 x 640 input. That wastes passes on the stands and the bench, and it gets worse as
the camera zooms out during a play: measured on a real clip, the camera zoomed out 1.6x in three seconds and the
people found fell from 94 a frame to 61, because every man had shrunk to 60% of his height in the frame.

Here the camera is held first (every frame's matrix onto the snap frame, `to_snap`), and then each frame is cut up
by what the camera sees of the field:

  * only the part of the field the tracker keeps people from (inside the sidelines, 25 yards either way of the ball),
    found in this frame's pixels through the calibration and `to_snap`;
  * in rows of square windows whose side is chosen so the farthest standing man in a row comes out `TARGET_MAN_PX` tall in
    the model's input (a far row is cut smaller, and so enlarged more) however far the camera has zoomed.

The detector is then run on the windows only. `plan_windows` is plain geometry and is tested without a model.
"""

from __future__ import annotations

import time
from typing import Callable

import cv2
import numpy as np

from geometry import transform_point

from .people import EDGE_YARDS, FIELD_WIDTH, PLAYER_YARDS

MODEL_SIDE = 640  # what the detector resizes every window to
TARGET_MAN_PX = 90.0  # how tall a standing man should be in that input
MIN_SIDE = 256  # never cut a window smaller than this (a tiny crop is blown up into mush)
MAX_SIDE = 1100
STEP = 0.75  # windows overlap by a quarter, so a man on an edge is whole in the next one
DEPTH_YARDS = 25.0  # the tracker keeps people this far either way of the ball (tracks.MAX_DEPTH)

Window = tuple[int, int, int, int]  # x0, y0, x1, y1 in pixels


def region_in_frame(
    calib: np.ndarray, to_snap: np.ndarray, ball_y: float, shape: tuple[int, ...]
) -> tuple[float, float, float, float] | None:
    """The box, in this frame's pixels, around the field the tracker keeps people from."""
    to_pixels = np.linalg.inv(calib)  # field yards -> snap-frame pixels
    from_snap = np.linalg.inv(to_snap)  # snap-frame pixels -> this frame's pixels
    corners = [
        (EDGE_YARDS, ball_y - DEPTH_YARDS), (FIELD_WIDTH - EDGE_YARDS, ball_y - DEPTH_YARDS),
        (EDGE_YARDS, ball_y + DEPTH_YARDS), (FIELD_WIDTH - EDGE_YARDS, ball_y + DEPTH_YARDS),
    ]
    pts = []
    for fx, fy in corners:
        sx, sy = transform_point(to_pixels, fx, fy)
        px, py = transform_point(from_snap, sx, sy)
        pts.append((px, py))
    h, w = shape[:2]
    x0, x1 = max(0.0, min(p[0] for p in pts)), min(float(w), max(p[0] for p in pts))
    y0, y1 = max(0.0, min(p[1] for p in pts)), min(float(h), max(p[1] for p in pts))
    return (x0, y0, x1, y1) if x1 - x0 > 40 and y1 - y0 > 40 else None


def man_height_at(
    pixels_per_yard: Callable[[float, float], float], to_snap: np.ndarray
) -> Callable[[float, float], float]:
    """A function giving how tall a standing man is (pixels) at a point of this frame, given the snap frame's
    pixels-per-yard and the frame's matrix onto the snap frame."""

    def at(px: float, py: float) -> float:
        sx, sy = transform_point(to_snap, px, py)
        # A frame pixel is `local` snap pixels wide: more than 1 when the camera has zoomed out since the snap.
        sx2, sy2 = transform_point(to_snap, px + 1.0, py)
        local = float(np.hypot(sx2 - sx, sy2 - sy)) or 1.0
        return PLAYER_YARDS * pixels_per_yard(sx, sy) / local

    return at


def plan_windows(
    region: tuple[float, float, float, float],
    shape: tuple[int, ...],
    height_at: Callable[[float, float], float],
    target: float = TARGET_MAN_PX,
) -> list[Window]:
    """Rows of square windows over `region`, each row's side set so a man in it is `target` pixels tall in the model's input."""
    h, w = shape[:2]
    x0, y0, x1, y1 = region
    cx = (x0 + x1) / 2
    windows: list[Window] = []
    y = y0
    while y < y1 - 1:
        side = MIN_SIDE
        for _ in range(3):  # the man's height depends on where the row ends up: settle it
            # The smallest man in the row is the one at its far edge: he is the one to make `target` tall, and the
            # nearer men in the same row then come out larger, which a detector doesn't mind.
            man = max(height_at(cx, min(y + 0.15 * side, y1)), 8.0)
            side = int(np.clip(MODEL_SIDE * man / target, MIN_SIDE, MAX_SIDE))
        side_y = min(side, h)
        top = int(min(y, h - side_y))
        x = x0
        while True:
            left = int(min(x, w - side))
            windows.append((max(left, 0), max(top, 0), min(left + side, w), min(top + side_y, h)))
            if x + side >= x1:
                break
            x += side * STEP
        y += side_y * STEP
    # The same window can be asked for twice at the clip edges.
    return list(dict.fromkeys(windows))


def detect_play(
    frames: list[np.ndarray],
    to_snap: list[np.ndarray],
    calib: np.ndarray,
    ball_y: float,
    pixels_per_yard: Callable[[float, float], float],
    detector,
    target: float = TARGET_MAN_PX,
    stats: dict | None = None,
) -> list[list[tuple[float, float, float, float, float]]]:
    """The people in every frame, found in the play's region at a constant man size. `detector.people_in_windows(frame, windows)`
    returns boxes in the frame's own pixels."""
    out = []
    passes = []
    began = time.perf_counter()
    for frame, m in zip(frames, to_snap):
        region = region_in_frame(calib, m, ball_y, frame.shape)
        if region is None:
            windows: list[Window] = [(0, 0, frame.shape[1], frame.shape[0])]
        else:
            windows = plan_windows(region, frame.shape, man_height_at(pixels_per_yard, m), target)
        passes.append(len(windows))
        out.append(detector.people_in_windows(frame, windows))
    if stats is not None:
        stats["detect_seconds"] = time.perf_counter() - began
        stats["windows_per_frame"] = float(np.mean(passes)) if passes else 0.0
        stats["windows_first"] = passes[0] if passes else 0
        stats["windows_last"] = passes[-1] if passes else 0
    return out

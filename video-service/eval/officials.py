"""Spotting the referees: the one kind of person on the field who isn't a player or a coach and
who looks like neither. They wear black and white stripes, so the middle of the body is part
dark and part bright and flips between the two many times across its width, which a jersey
(one color, a number on it) doesn't. Measured on real film from the sideline: both referees
had about a third of their pixels dark, a tenth to a fifth bright, and 6-7 dark/bright flips
across the width; white-jersey players had almost nothing dark (< 5%), and navy players, even
with white numbers, flipped less than 5 times or had far fewer bright pixels.

Coaches and staff in plain clothes aren't caught by this. They stand at the sidelines, which the
field edge already drops, and the rest are told apart from players by where they stand.
"""

from __future__ import annotations

import cv2
import numpy as np

Box = tuple[float, float, float, float, float]

DARK_LEVEL = 70
BRIGHT_LEVEL = 150
MID_LEVEL = 110
MIN_DARK = 0.25
MIN_BRIGHT = 0.10
MIN_FLIPS = 5.5


def stripe_stats(frame_bgr: np.ndarray, box: Box) -> tuple[float, float, float]:
    """(share of dark pixels, share of bright pixels, dark/bright flips per row) on the upper body."""
    x1, y1, x2, y2, _ = box
    w, h = x2 - x1, y2 - y1
    crop = frame_bgr[int(y1 + 0.15 * h) : int(y1 + 0.55 * h), int(x1 + 0.12 * w) : int(x2 - 0.12 * w)]
    if crop.size == 0 or crop.shape[1] < 3:
        return 0.0, 0.0, 0.0
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    flips = np.abs(np.diff((gray > MID_LEVEL).astype(np.int8), axis=1)).sum(axis=1)
    return float(np.mean(gray < DARK_LEVEL)), float(np.mean(gray > BRIGHT_LEVEL)), float(np.mean(flips))


def looks_like_official(frame_bgr: np.ndarray, box: Box) -> bool:
    dark, bright, flips = stripe_stats(frame_bgr, box)
    return dark >= MIN_DARK and bright >= MIN_BRIGHT and flips >= MIN_FLIPS

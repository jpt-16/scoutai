"""Where a detected person stands on the field, shared by the formation read and the tracker.

A box's bottom is his feet, unless the people in front of him hide them (the bench on the near
sideline): then the box is much shorter than a standing man at that spot would be, and his feet are
taken from his head instead. See `feet_locator`.
"""

from __future__ import annotations

from typing import Callable

import cv2
import numpy as np

from geometry import transform_point

FIELD_WIDTH = 160 / 3
# A player stands at least this far inside a sideline (yards). People closer to it, or past it, are the
# bench, the coaches or the officials: on real film the far sideline is lined with a whole team standing
# 2-3 yards inside where the mapping puts the line, and the near sideline is lined with the bench.
EDGE_YARDS = 3.0
# A standing player is about this many yards tall, and a camera sees a yard of height at about the same
# scale as a yard of ground along the field at that spot, so a box much shorter than this is a man cut
# off by the people standing in front of him (the bench), whose feet are hidden and whose box bottom
# therefore sits on the field when he is really off it.
PLAYER_YARDS = 2.0
SHORT_BOX_RATIO = 0.45
# A short box (a man cut off by the people in front of him) has only his head to place him by, so his
# spot is a guess. Real players are never that far in: this is how far inside a sideline such a box has to
# land to count, which keeps the bench's heads (standing behind each other along the near sideline) off the field.
SHORT_EDGE_YARDS = 8.0
# Near a sideline the bench stands in rows, each man hidden to the chest or waist by the row in front, so his
# box is a half to three-quarters of a standing man's: too tall to be "short", but its bottom is no foot.
# A player there (a receiver running the sideline) is in front of the bench and shows in full, so within this many
# yards of a sideline only a box at least this fraction of a standing man's height counts.
SIDELINE_ZONE_YARDS = 10.0
FULL_BOX_RATIO = 0.8
# Below this fraction of a man's height a box near a sideline is never a player (a head over the bench row).
WEAK_BOX_RATIO = 0.4

Box = tuple[float, float, float, float, float]


def feet_locator(matrix: np.ndarray) -> Callable[[Box], tuple[float, float]]:
    """A function giving where a box's person stands on the field (x across, y along, in yards), for
    boxes in the pixels `matrix` (pixels -> yards) was made for."""
    inverse = np.linalg.inv(matrix)

    def pixels_per_yard(px: float, py: float) -> float:
        """How many pixels one yard along the field is, where the picture point (px, py) is."""
        fx, fy = transform_point(matrix, px, py)
        bx, by = transform_point(inverse, fx, fy + 1.0)
        return float(np.hypot(bx - px, by - py))

    def is_short(box: Box) -> bool:
        cx = (box[0] + box[2]) / 2
        return (box[3] - box[1]) / (PLAYER_YARDS * pixels_per_yard(cx, box[3])) < SHORT_BOX_RATIO

    def height_ratio(box: Box) -> float:
        """The box's height as a fraction of a standing man's at that spot (about 1 when he shows in full)."""
        cx = (box[0] + box[2]) / 2
        return (box[3] - box[1]) / (PLAYER_YARDS * pixels_per_yard(cx, box[3]))

    def feet_on_field(box: Box) -> tuple[float, float]:
        cx = (box[0] + box[2]) / 2
        fx, fy = transform_point(matrix, cx, box[3])
        if is_short(box):
            foot_y = box[1]
            for _ in range(25):
                foot_y = box[1] + PLAYER_YARDS * pixels_per_yard(cx, min(foot_y, 4000.0))
            fx, fy = transform_point(matrix, cx, min(foot_y, 4000.0))
        return fx, fy

    feet_on_field.pixels_per_yard = pixels_per_yard  # type: ignore[attr-defined]
    feet_on_field.short = is_short  # type: ignore[attr-defined]
    feet_on_field.height_ratio = height_ratio  # type: ignore[attr-defined]
    return feet_on_field


def on_the_field(fx: float, fy: float, ball_y: float, max_depth: float) -> bool:
    """Inside the sidelines by `EDGE_YARDS`, and not further from the ball than `max_depth` yards."""
    return EDGE_YARDS <= fx <= FIELD_WIDTH - EDGE_YARDS and abs(fy - ball_y) <= max_depth

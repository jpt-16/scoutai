"""Pure math + schemas: homography setup, calibration validation, and the
request/response shapes. Deliberately has no torch/transformers/supervision
dependency, so it (and its tests) run with nothing heavier than opencv,
numpy, and pydantic installed — no GPU, no model weights, no video file.

main.py imports from here and adds the detection/tracking/GPU-dependent
pieces on top.
"""

from __future__ import annotations

import numpy as np
import cv2
from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator


class CalibrationPoints(BaseModel):
    """4 pixel points and the field-yardage points they correspond to.

    `cv2.getPerspectiveTransform` (used below) is an exact solve for exactly
    4 point pairs, not a least-squares fit — so both lists must have exactly
    4 entries, in matching order (source[i] maps to destination[i]).
    """

    source: list[tuple[float, float]] = Field(..., description="4 pixel [x, y] points in the frame")
    destination: list[tuple[float, float]] = Field(
        ..., description="4 field [x, y] points in yards that `source` maps to"
    )

    @field_validator("source", "destination")
    @classmethod
    def _exactly_four_points(cls, points: list[tuple[float, float]]) -> list[tuple[float, float]]:
        if len(points) != 4:
            raise ValueError(f"expected exactly 4 points, got {len(points)}")
        return points


class RoutePoint(BaseModel):
    frame: int
    x: float
    y: float


class PlayerRoute(BaseModel):
    route: list[RoutePoint]


class ProcessPlayResponse(BaseModel):
    status: str
    total_players_tracked: int
    play_data: dict[str, PlayerRoute]


def _is_degenerate(points: np.ndarray) -> bool:
    """True if 4 points are (near-)collinear, which makes the perspective
    transform singular or numerically garbage. `getPerspectiveTransform`
    doesn't always raise on this — it can silently return a matrix that maps
    everything to nonsense — so this is checked explicitly before calling it.
    """
    # Sum of the (signed) areas of the two triangles the quad splits into.
    # Near-zero means the points don't actually span a 2D region.
    a, b, c, d = points
    area1 = abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]))
    area2 = abs((c[0] - a[0]) * (d[1] - a[1]) - (d[0] - a[0]) * (c[1] - a[1]))
    return (area1 + area2) < 1e-6


def build_homography(calibration: CalibrationPoints) -> np.ndarray:
    """Computes the 3x3 perspective-transform matrix once per request, from
    the 4 calibration pairs. Reused for every player, every frame.
    """
    src = np.array(calibration.source, dtype=np.float32)
    dst = np.array(calibration.destination, dtype=np.float32)

    if _is_degenerate(src):
        raise HTTPException(status_code=400, detail="Calibration source points are collinear/degenerate")
    if _is_degenerate(dst):
        raise HTTPException(status_code=400, detail="Calibration destination points are collinear/degenerate")

    try:
        matrix = cv2.getPerspectiveTransform(src, dst)
    except cv2.error as exc:
        raise HTTPException(status_code=400, detail=f"Could not compute homography: {exc}") from exc

    if not np.all(np.isfinite(matrix)):
        raise HTTPException(status_code=400, detail="Homography matrix is degenerate (non-finite)")

    return matrix


def transform_point(matrix: np.ndarray, x: float, y: float) -> tuple[float, float]:
    """Maps one pixel point through the homography into field yards."""
    pt = np.array([[[x, y]]], dtype=np.float32)  # shape (1, 1, 2), what cv2 expects
    out = cv2.perspectiveTransform(pt, matrix)
    return float(out[0, 0, 0]), float(out[0, 0, 1])

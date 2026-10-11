"""eval/field.py on drawn fields: the matrix it finds has to put pixels on the field in yards
(up to the field's own rotation: it can't know which end is which number)."""

import cv2
import numpy as np
import pytest

import synthfield as sf
from eval.field import FieldFailure, FieldFit, calibrate_field


def isometry_error(found: np.ndarray, truth_world_to_pixel: np.ndarray, grid) -> float:
    """Worst change in the distance between two points, truth vs. found, over a grid of field points."""
    px = cv2.perspectiveTransform(np.float32([grid]), truth_world_to_pixel)[0]
    est = cv2.perspectiveTransform(px.reshape(1, -1, 2), found)[0]
    worst = 0.0
    for i in range(len(grid)):
        for j in range(i + 1, len(grid)):
            d_true = np.hypot(*(np.array(grid[i]) - np.array(grid[j])))
            d_est = np.hypot(*(est[i] - est[j]))
            worst = max(worst, abs(d_true - d_est))
    return worst


def handedness_kept(found: np.ndarray, truth_world_to_pixel: np.ndarray) -> bool:
    """A turned copy of the field keeps left-handed vs. right-handed; a mirror image doesn't."""
    a, b, c = [(25, 45), (30, 45), (25, 50)]
    px = cv2.perspectiveTransform(np.float32([[a, b, c]]), truth_world_to_pixel)[0]
    e = cv2.perspectiveTransform(px.reshape(1, -1, 2), found)[0]
    cross_true = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    cross_est = (e[1][0] - e[0][0]) * (e[2][1] - e[0][1]) - (e[1][1] - e[0][1]) * (e[2][0] - e[0][0])
    return cross_true * cross_est > 0


GRID = [(x, y) for x in (6, 18, 27, 40, 48) for y in (36, 44, 52, 60)]


@pytest.mark.parametrize("quad,name", [(sf.QUAD_A, "down the field"), (sf.QUAD_B, "from the stands")])
def test_finds_the_field_from_the_paint(quad, name):
    frame, truth = sf.render(quad)
    fit = calibrate_field(frame)
    assert isinstance(fit, FieldFit), (name, fit)
    assert fit.residual < 0.4
    grid = [(x, y) for x, y in GRID if 36 <= y <= 60]
    assert isometry_error(fit.to_field, truth, grid) < 0.6, name
    assert handedness_kept(fit.to_field, truth), name


def test_survives_a_noisy_frame():
    frame, truth = sf.render(sf.QUAD_B)
    rng = np.random.default_rng(1)
    noisy = np.clip(frame.astype(np.int16) + rng.normal(0, 7, frame.shape), 0, 255).astype(np.uint8)
    noisy = cv2.GaussianBlur(noisy, (0, 0), 1.0)
    fit = calibrate_field(noisy)
    assert isinstance(fit, FieldFit), fit
    assert isometry_error(fit.to_field, truth, GRID) < 0.8


def test_says_why_when_there_is_no_field():
    frame = np.full((1080, 1920, 3), (90, 90, 90), np.uint8)
    out = calibrate_field(frame)
    assert isinstance(out, FieldFailure)
    assert out.reason == "no_lines"


def test_refuses_to_guess_with_too_few_rows():
    # Yard lines but no sidelines and no hash marks: the other direction has no scale.
    frame, _ = sf.render(sf.QUAD_A, sf.top_down(ticks=False, sidelines=False))
    out = calibrate_field(frame)
    assert isinstance(out, FieldFailure) and out.reason == "rows", out

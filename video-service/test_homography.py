"""Tests for the pure-math parts of the service: the homography setup and
calibration validation, both in geometry.py (deliberately free of any
torch/transformers/supervision dependency). These don't need a GPU, the
detection model, or a real video file, so they run anywhere
(`pytest video-service/test_homography.py`).

The detection/tracking/endpoint code in main.py isn't covered here since it
needs torch + transformers + supervision installed and (for a real run) a
GPU — see README.md for the end-to-end test to run on a GPU host.
"""

import pytest
from fastapi import HTTPException
from geometry import CalibrationPoints, build_homography, transform_point


def _calibration(source, destination):
    return CalibrationPoints(source=source, destination=destination)


def test_axis_aligned_square_maps_corners_exactly():
    # A 100x100px on-screen square representing a 10x10 yard field zone,
    # corners in the same (clockwise) order on both sides.
    cal = _calibration(
        source=[(0, 0), (100, 0), (100, 100), (0, 100)],
        destination=[(0, 0), (10, 0), (10, 10), (0, 10)],
    )
    matrix = build_homography(cal)

    x, y = transform_point(matrix, 0, 0)
    assert x == pytest.approx(0, abs=1e-4)
    assert y == pytest.approx(0, abs=1e-4)

    x, y = transform_point(matrix, 100, 100)
    assert x == pytest.approx(10, abs=1e-4)
    assert y == pytest.approx(10, abs=1e-4)


def test_midpoint_maps_to_midpoint_for_an_axis_aligned_square():
    cal = _calibration(
        source=[(0, 0), (100, 0), (100, 100), (0, 100)],
        destination=[(0, 0), (10, 0), (10, 10), (0, 10)],
    )
    matrix = build_homography(cal)

    x, y = transform_point(matrix, 50, 50)
    assert x == pytest.approx(5, abs=1e-4)
    assert y == pytest.approx(5, abs=1e-4)


def test_oblique_source_quad_maps_to_a_true_top_down_box():
    # Simulates a sideline camera: the far side of the box is narrower
    # on-screen (perspective foreshortening) than the near side, but both
    # map onto the same true 53.3-yard-wide, 10-yard-deep field zone.
    cal = _calibration(
        source=[(50, 0), (450, 0), (500, 200), (0, 200)],
        destination=[(0, 0), (53.3, 0), (53.3, 10), (0, 10)],
    )
    matrix = build_homography(cal)

    x, y = transform_point(matrix, 0, 200)
    assert x == pytest.approx(0, abs=1e-3)
    assert y == pytest.approx(10, abs=1e-3)

    x, y = transform_point(matrix, 500, 200)
    assert x == pytest.approx(53.3, abs=1e-3)
    assert y == pytest.approx(10, abs=1e-3)


def test_wrong_point_count_is_rejected_before_reaching_opencv():
    with pytest.raises(Exception):  # pydantic.ValidationError
        _calibration(
            source=[(0, 0), (100, 0), (100, 100)],  # only 3
            destination=[(0, 0), (10, 0), (10, 10), (0, 10)],
        )


def test_collinear_source_points_are_rejected():
    cal = _calibration(
        source=[(0, 0), (10, 0), (20, 0), (30, 0)],  # all on one line
        destination=[(0, 0), (10, 0), (10, 10), (0, 10)],
    )
    with pytest.raises(HTTPException) as exc_info:
        build_homography(cal)
    assert exc_info.value.status_code == 400


def test_collinear_destination_points_are_rejected():
    cal = _calibration(
        source=[(0, 0), (100, 0), (100, 100), (0, 100)],
        destination=[(0, 0), (5, 0), (10, 0), (15, 0)],  # all on one line
    )
    with pytest.raises(HTTPException) as exc_info:
        build_homography(cal)
    assert exc_info.value.status_code == 400

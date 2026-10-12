"""Detecting where the play is, at a constant man size: the geometry, without a model."""

import cv2
import numpy as np

from geometry import CalibrationPoints, build_homography
from eval.people import FIELD_WIDTH, feet_locator
from eval.regiondetect import MIN_SIDE, MODEL_SIDE, TARGET_MAN_PX, detect_play, man_height_at, plan_windows, region_in_frame

W, H = 1470, 956
# A sideline camera. The field's x runs across it (into the picture: the near sideline at the bottom, the far one near
# the top) and its y along it (left to right), 35 yards of which are in view.
FIELD_PTS = [(0.0, 0.0), (0.0, 35.0), (FIELD_WIDTH, 0.0), (FIELD_WIDTH, 35.0)]
PIXEL_PTS = [(60.0, 900.0), (1410.0, 900.0), (330.0, 300.0), (1140.0, 300.0)]
BALL_Y = 17.5


def calib():
    return build_homography(CalibrationPoints(source=[list(p) for p in PIXEL_PTS], destination=[list(p) for p in FIELD_PTS]))


def zoomed_out(scale: float) -> np.ndarray:
    """A frame the camera has zoomed out of, about the middle: its pixels are `scale` snap pixels wide."""
    cx, cy = W / 2, H / 2
    return np.array([[scale, 0, cx * (1 - scale)], [0, scale, cy * (1 - scale)], [0, 0, 1]], np.float64)


def plan(scale: float):
    c = calib()
    m = zoomed_out(scale)
    region = region_in_frame(c, m, BALL_Y, (H, W))
    assert region is not None
    ppy = feet_locator(c).pixels_per_yard
    return region, plan_windows(region, (H, W), man_height_at(ppy, m)), m, ppy


def test_the_region_is_the_field_the_tracker_keeps_people_from_and_nothing_else():
    region, _, _, _ = plan(1.0)
    x0, y0, x1, y1 = region
    # Not the whole picture: the stands above the far sideline are left out.
    assert y0 > 250 and (y1 - y0) < 0.75 * H
    assert x1 - x0 > 600


def test_windows_cover_the_region_and_use_far_fewer_passes_than_a_four_by_four_grid():
    region, windows, _, _ = plan(1.0)
    x0, y0, x1, y1 = region
    cover = np.zeros((H, W), bool)
    for a, b, c, d in windows:
        cover[b:d, a:c] = True
    assert cover[int(y0) + 1 : int(y1) - 1, int(x0) + 1 : int(x1) - 1].all()
    # Tiles=4 is 1 + 16 passes a frame.
    assert len(windows) < 17


def test_the_farthest_man_in_every_row_is_at_least_the_target_size_to_the_model():
    _, windows, m, ppy = plan(1.0)
    height_at = man_height_at(ppy, m)
    for x0, y0, x1, y1 in windows:
        side = x1 - x0
        if side <= MIN_SIDE or y1 - y0 != side:
            continue  # a window at the floor or a frame edge
        far = height_at((x0 + x1) / 2, y0 + 0.15 * side)
        assert far * MODEL_SIDE / side > 0.8 * TARGET_MAN_PX


def test_when_the_camera_zooms_out_the_windows_shrink_so_a_man_stays_the_same_size():
    _, near, _, _ = plan(1.0)
    _, far, _, _ = plan(1.6)
    # A man is 1.6 times shorter in the frame, so each window is cut about 1.6 times smaller (down to the floor).
    sides_near = sorted({w[2] - w[0] for w in near})
    sides_far = sorted({w[2] - w[0] for w in far})
    assert max(sides_far) < max(sides_near)
    ratio = max(sides_near) / max(sides_far)
    assert 1.2 < ratio < 1.9


def test_detect_play_asks_the_detector_for_the_windows_of_every_frame_and_reports_the_cost():
    c = calib()
    ppy = feet_locator(c).pixels_per_yard

    class Stub:
        def __init__(self) -> None:
            self.calls: list[int] = []

        def people_in_windows(self, frame, windows):
            self.calls.append(len(windows))
            return [(100.0, 100.0, 140.0, 190.0, 0.9)]

    frames = [np.zeros((H, W, 3), np.uint8) for _ in range(3)]
    stub = Stub()
    stats: dict = {}
    boxes = detect_play(frames, [np.eye(3), zoomed_out(1.2), zoomed_out(1.5)], c, BALL_Y, ppy, stub, stats=stats)
    assert len(boxes) == 3 and all(len(b) == 1 for b in boxes)
    assert stub.calls and stats["windows_first"] == stub.calls[0] and stats["windows_last"] == stub.calls[-1]
    assert stats["detect_seconds"] >= 0

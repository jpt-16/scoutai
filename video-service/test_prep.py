"""Cutting a screen recording of Hudl down to the film."""

from pathlib import Path

import cv2
import numpy as np

from eval.prep import EDGE_FRAMES, crop_clip, player_frames


def test_keeps_the_longest_full_screen_run_less_the_switch():
    tops = [80.0] * 50 + [0.5] * 300 + [80.0] * 40
    assert player_frames(tops) == (50 + EDGE_FRAMES, 349 - EDGE_FRAMES)
    # Full screen from the first frame: nothing to drop at the start.
    assert player_frames([0.2] * 100 + [85.0] * 10) == (0, 99 - EDGE_FRAMES)
    assert player_frames([0.2] * 100) == (0, 99)
    assert player_frames([84.0] * 20) is None
    # A blip of black on the desktop doesn't beat the real run.
    assert player_frames([0.0] * 5 + [80.0] * 10 + [0.0] * 200) == (15 + EDGE_FRAMES, 214)


def test_crop_drops_the_desktop_frames(tmp_path: Path):
    src = tmp_path / "rec.mp4"
    out = cv2.VideoWriter(str(src), cv2.VideoWriter_fourcc(*"mp4v"), 30, (320, 240))
    for i in range(60):
        frame = np.full((240, 320, 3), 90, np.uint8)
        if i >= 20:
            frame[:40] = 0  # the player's black top strip
        out.write(frame)
    out.release()
    n = crop_clip(src, tmp_path / "play.mp4", top=40, bottom=20)
    assert n == 60 - 20 - EDGE_FRAMES
    cap = cv2.VideoCapture(str(tmp_path / "play.mp4"))
    assert int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) == 180

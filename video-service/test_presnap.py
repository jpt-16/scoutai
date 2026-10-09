"""End to end on a drawn field: everything in eval/presnap.py except the detector model.

A synthetic clip puts jerseys on a perspective field at known yard spots; a stand-in
detector hands back their boxes. If the calibration, the offense's direction, the team
split and the formation rules agree, the formation comes out as the one drawn.
Needs numpy, opencv, fastapi and pydantic (see requirements.txt), not torch.
"""

import json

import cv2
import numpy as np
import pytest

from eval.presnap import read_clip

FIELD_W = 160 / 3
BALL = (26.67, 50.0)
# Where the field's corners land in a 1920x1080 frame: a sideline-ish view with perspective.
FIELD_QUAD = [(0, 30), (FIELD_W, 30), (0, 70), (FIELD_W, 70)]
PIXEL_QUAD = [(100, 980), (1820, 980), (480, 260), (1440, 260)]
H = cv2.getPerspectiveTransform(np.float32(FIELD_QUAD), np.float32(PIXEL_QUAD))

TRIPS_RIGHT = [  # (x right, y downfield) in yards from the ball
    (-4, 0), (-2, 0), (0, 0), (2, 0), (4, 0),  # line
    (0, -5), (1.5, -5),  # shotgun Q and a back
    (-15, 0), (9, 0), (13, -1), (19, 0),  # X, and three to the right
]
# The defensive line lines up in the gaps, so nobody is hidden completely.
DEFENSE = [(-5, 1), (-3, 1), (-1, 1), (1, 1), (3, 1), (5, 1), (-9, 4), (0, 5), (9, 4), (-16, 7), (17, 7), (-6, 12), (6, 12)]


def px(field_xy):
    out = cv2.perspectiveTransform(np.float32([[field_xy]]), H)[0, 0]
    return float(out[0]), float(out[1])


class StandIn:
    def __init__(self, boxes):
        self.boxes = boxes

    def people(self, frame, tiles):
        return self.boxes


def make_clip(tmp_path, direction):
    frame = np.full((1080, 1920, 3), 60, np.uint8)
    boxes = []
    # Far players first, so a nearer one hides part of a farther one, like a real camera.
    everyone = [(x, y, (30, 30, 200)) for x, y in TRIPS_RIGHT] + [(x, y, (200, 120, 30)) for x, y in DEFENSE]
    for x, y, color in sorted(everyone, key=lambda p: -p[1] * direction):
        fx, fy = BALL[0] + x * direction, BALL[1] + y * direction
        foot = px((fx, fy))
        h = 90 * (foot[1] / 1080) + 20
        box = (foot[0] - h * 0.18, foot[1] - h, foot[0] + h * 0.18, foot[1], 0.9)
        cv2.rectangle(frame, (int(box[0]), int(box[1])), (int(box[2]), int(box[3])), color, -1)
        boxes.append(box)
    clip = tmp_path / "play_07.mp4"
    out = cv2.VideoWriter(str(clip), cv2.VideoWriter_fourcc(*"mp4v"), 30, (1920, 1080))
    for _ in range(3):
        out.write(frame)
    out.release()
    marks = [(17.78, 35), (FIELD_W - 17.78, 35), (17.78, 55), (FIELD_W - 17.78, 55)]
    clip.with_suffix(".json").write_text(
        json.dumps(
            {
                "frame": 1,
                "source": [list(px(m)) for m in marks],
                "destination": [list(m) for m in marks],
                "ball": list(px(BALL)),
                "direction": direction,
            }
        )
    )
    return clip, boxes


@pytest.mark.parametrize("direction", [1, -1])
def test_reads_trips_right_whichever_way_the_offense_is_going(tmp_path, direction):
    clip, boxes = make_clip(tmp_path, direction)
    result = read_clip(clip, StandIn(boxes), tiles=1, debug_dir=tmp_path / "debug")
    f = result["formation"]
    assert (f.key, f.strength) == ("trips", "right"), f
    assert result["offense"] == len(TRIPS_RIGHT)
    assert (tmp_path / "debug" / "play_07.jpg").exists()

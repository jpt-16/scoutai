"""eval/autocalib.py end to end on a drawn field: no calibration file is given, only the clip.
If the snap, the field, the ball and the direction are right, the formation the presnap reader
names from the generated calibration is the one drawn."""

import json

import cv2
import numpy as np
import pytest

import synthfield as sf
from eval.autocalib import SceneFailure, auto_calibrate, find_snap, locate_scene
from eval.presnap import read_clip
from test_presnap import DEFENSE, TRIPS_RIGHT

BALL = (26.67, 50.0)
SNAP_AT = 30


class StandIn:
    def __init__(self, boxes):
        self.boxes = boxes

    def people(self, frame, tiles):
        return self.boxes


def make_game_clip(tmp_path, quad, direction):
    base, h = sf.render(quad)

    def px(x, y):
        out = cv2.perspectiveTransform(np.float32([[[x, y]]]), h)[0, 0]
        return float(out[0]), float(out[1])

    def draw(frame, offsets):
        boxes = []
        everyone = [(x, y, (30, 30, 200), 1) for x, y in TRIPS_RIGHT] + [(x, y, (200, 120, 30), -1) for x, y in DEFENSE]
        # Far players first, so a nearer one hides part of a farther one.
        order = sorted(everyone, key=lambda p: -(BALL[1] + p[1] * direction) * (1 if quad is sf.QUAD_A else 0))
        for x, y, color, side in order:
            # Offense (side 1) goes upfield after the snap; the defense (side -1) comes back at them.
            foot = px(BALL[0] + x * direction, BALL[1] + (y + offsets * side) * direction)
            hh = 90 * (foot[1] / 1080) + 20
            box = (foot[0] - hh * 0.18, foot[1] - hh, foot[0] + hh * 0.18, foot[1], 0.9)
            cv2.rectangle(frame, (int(box[0]), int(box[1])), (int(box[2]), int(box[3])), color, -1)
            boxes.append(box)
        return boxes

    clip = tmp_path / "play_03.mp4"
    out = cv2.VideoWriter(str(clip), cv2.VideoWriter_fourcc(*"mp4v"), 30, (1920, 1080))
    pre_boxes = []
    for i in range(60):
        frame = base.copy()
        # Still while they set, then everyone runs: offense upfield, defense toward them.
        boxes = draw(frame, 0.0 if i < SNAP_AT else (i - SNAP_AT) * 0.4)
        if i == SNAP_AT - 1:
            pre_boxes = boxes
        out.write(frame)
    out.release()
    return clip, pre_boxes


def test_find_snap_is_the_jump_in_motion():
    still = np.zeros((90, 160), np.uint8)
    rng = np.random.default_rng(0)
    frames = [still.copy() for _ in range(40)] + [rng.integers(0, 255, (90, 160)).astype(np.uint8) for _ in range(40)]
    assert abs(find_snap(frames, 30) - 39) <= 2


def scene_points(direction, ball=(26.67, 50.0)):
    pts = [(ball[0] + x * direction, ball[1] + y * direction) for x, y in TRIPS_RIGHT]
    pts += [(ball[0] + x * direction, ball[1] + y * direction) for x, y in DEFENSE]
    labels = [0] * len(TRIPS_RIGHT) + [1] * len(DEFENSE)
    return pts, labels


@pytest.mark.parametrize("direction", [1, -1])
@pytest.mark.parametrize("flip_colors", [False, True])
def test_ball_and_direction_from_where_people_stand(direction, flip_colors):
    pts, labels = scene_points(direction)
    if flip_colors:
        labels = [1 - l for l in labels]
    scene = locate_scene(pts, labels)
    assert not isinstance(scene, SceneFailure), scene
    assert scene.direction == direction
    assert abs(scene.ball[0] - 26.67) < 1.0 and abs(scene.ball[1] - 50.0) < 0.7
    assert scene.offense_label == (1 if flip_colors else 0)


def test_two_teams_that_overlap_are_not_a_snap():
    pts = [(10 + i, 50 + (i % 3) * 0.2) for i in range(12)]
    out = locate_scene(pts, [0, 1] * 6)
    assert isinstance(out, SceneFailure)


@pytest.mark.parametrize("quad", [sf.QUAD_A, sf.QUAD_B], ids=["down the field", "from the stands"])
@pytest.mark.parametrize("direction", [1, -1])
def test_calibrates_a_clip_and_reads_the_formation_with_no_clicks(tmp_path, quad, direction):
    clip, boxes = make_game_clip(tmp_path, quad, direction)
    calibration = auto_calibrate(clip, StandIn(boxes), tiles=1, debug_dir=tmp_path / "debug")
    assert isinstance(calibration, dict), calibration
    assert abs(calibration["frame"] - (SNAP_AT - 1)) <= 3
    assert calibration["auto"]["offense"] == len(TRIPS_RIGHT)
    clip.with_suffix(".json").write_text(json.dumps(calibration))
    result = read_clip(clip, StandIn(boxes), tiles=1, debug_dir=None)
    f = result["formation"]
    assert (f.key, f.strength) == ("trips", "right"), f
    assert (tmp_path / "debug" / "play_03_auto.jpg").exists()

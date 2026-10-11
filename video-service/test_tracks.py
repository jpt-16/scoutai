"""The hard part, on a drawn clip with a moving camera: follow players through a play while the
camera pans and zooms, and get their paths back in yards, then name the routes.

The "field" is a textured picture (so the background has something to match), players are
colored boxes moving along known routes, and the camera pans and zooms through the play. A
stand-in detector hands back each player's box with a little noise. If hold-the-camera-still
and the tracker work, the recovered paths match the ones drawn, in yards, and the route reader
names them.

Needs numpy, opencv, fastapi, pydantic and Node (for the route reader); not torch.
"""

import json
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np
import pytest

from eval.tracks import follow, track_play

ROOT = Path(__file__).resolve().parent.parent
PX_PER_YARD = 20  # the world picture
FPS = 30
FRAMES = 91  # three seconds after the snap
BALL = (26.67, 50.0)  # field yards, across and along


def world_px(x_yd: float, y_yd: float) -> tuple[float, float]:
    """Field yards to a pixel of the big picture (y up the field is up the picture)."""
    return 200 + x_yd * PX_PER_YARD, 1600 - y_yd * PX_PER_YARD


def make_field() -> np.ndarray:
    rng = np.random.default_rng(3)
    field = (rng.random((1800, 1400)) * 60 + 90).astype(np.uint8)
    field = cv2.GaussianBlur(field, (0, 0), 2)
    field = cv2.cvtColor(field, cv2.COLOR_GRAY2BGR)
    field[:, :, 1] = np.clip(field[:, :, 1] + 40, 0, 255)  # grass
    # Yard lines every 5 yards, hashes, and numbers-ish blobs give the matcher corners to hold.
    for yd in range(0, 100, 5):
        _, y = world_px(0, yd)
        cv2.line(field, (150, int(y)), (1350, int(y)), (240, 240, 240), 3)
    for yd in range(0, 100, 2):
        for hx in (17.78, 35.56):
            x, y = world_px(hx, yd)
            cv2.line(field, (int(x) - 6, int(y)), (int(x) + 6, int(y)), (240, 240, 240), 2)
    for _ in range(150):
        cv2.circle(field, (int(rng.integers(200, 1300)), int(rng.integers(100, 1700))), int(rng.integers(3, 9)),
                   tuple(int(c) for c in rng.integers(40, 220, 3)), -1)
    return field


def camera_at(i: int) -> np.ndarray:
    """World picture to frame: a pan to the right and up the field with a slow zoom."""
    zoom = 1.0 + 0.0005 * i
    pan_x, pan_y = 4.0 * i, -3.0 * i
    shift = np.array([[zoom, 0, -(500 + pan_x)], [0, zoom, -(900 + pan_y)], [0, 0, 1]], np.float64)
    return shift


# What the receivers do: (start across, start up) relative to the ball, then a path every frame.
def route(kind: str, x0: float, y0: float, outside: int, t: float) -> tuple[float, float]:
    speed = 6.0
    d = speed * t
    if kind == "go":
        return x0, y0 + d
    if kind == "slant":  # three yards up, then toward the middle
        up = min(d, 3.0)
        rest = max(0.0, d - 3.0)
        return x0 - outside * rest * 0.7, y0 + up + rest * 0.7
    if kind == "out":  # ten yards up, then to the sideline
        up = min(d, 10.0)
        rest = max(0.0, d - 10.0)
        return x0 + outside * rest, y0 + up
    raise ValueError(kind)


def simulate(tmp_path):
    rng = np.random.default_rng(11)
    field = make_field()
    # Receivers, with their sides: X left, Z right, Y in the slot right.
    receivers = {"X": ("go", -15.0, 0.0, -1), "Z": ("slant", 17.0, 0.0, 1), "Y": ("out", 9.0, -1.0, 1)}
    # Everyone else holds still-ish: five linemen, a QB, a back, and eleven defenders in two groups.
    still = [(-4, 0), (-2, 0), (0, 0), (2, 0), (4, 0), (0, -5), (1.5, -5)] + [
        (-5, 1), (-3, 1), (-1, 1), (1, 1), (3, 1), (5, 1), (-9, 4), (0, 5), (9, 4), (-16, 7), (17, 7), (-6, 12), (6, 12)
    ]
    n_off_still = 7
    frames, boxes, truth = [], [], {name: [] for name in receivers}
    for i in range(FRAMES):
        t = i / FPS
        world = field.copy()
        people = []  # (x_yd_from_ball, y_yd_from_ball, color)
        for name, (kind, x0, y0, outside) in receivers.items():
            x, y = route(kind, x0, y0, outside, t)
            truth[name].append((x, y))
            people.append((x, y, (30, 30, 200)))
        for k, (x, y) in enumerate(still):
            wobble = rng.normal(0, 0.03, 2)
            people.append((x + wobble[0], y + wobble[1], (30, 30, 200) if k < n_off_still else (200, 120, 30)))
        # Far (up the field) players first, so a nearer one hides part of a farther one.
        order = sorted(range(len(people)), key=lambda k: -people[k][1])
        world_boxes = {}
        for k in order:
            x, y, color = people[k]
            px, py = world_px(BALL[0] + x, BALL[1] + y)
            h, w = 2.0 * PX_PER_YARD, 0.8 * PX_PER_YARD
            cv2.rectangle(world, (int(px - w / 2), int(py - h)), (int(px + w / 2), int(py)), color, -1)
            world_boxes[k] = (px - w / 2, py - h, px + w / 2, py)
        cam = camera_at(i)
        frame = cv2.warpPerspective(world, cam, (900, 700), flags=cv2.INTER_LINEAR)
        frames.append(frame)
        frame_boxes = []
        for k in range(len(people)):
            x1, y1, x2, y2 = world_boxes[k]
            corners = cv2.perspectiveTransform(np.float32([[[x1, y1], [x2, y2]]]), cam)[0]
            noise = rng.normal(0, 1.0, 4)
            frame_boxes.append((corners[0][0] + noise[0], corners[0][1] + noise[1], corners[1][0] + noise[2], corners[1][1] + noise[3], 0.9))
        boxes.append(frame_boxes)
    # The calibration was made on the snap frame: four known spots on the field.
    cam0 = camera_at(0)
    marks = [(17.78, 40.0), (35.56, 40.0), (17.78, 60.0), (35.56, 60.0)]
    source = [list(cv2.perspectiveTransform(np.float32([[list(world_px(*m))]]), cam0)[0][0]) for m in marks]
    ball_px = cv2.perspectiveTransform(np.float32([[list(world_px(*BALL))]]), cam0)[0][0]
    calibration = {
        "frame": 0,
        "source": source,
        "destination": [list(m) for m in marks],
        "ball": list(ball_px),
        "direction": 1,
    }
    return frames, boxes, calibration, receivers, truth, len(receivers) + n_off_still


def jersey_team(_frame, _boxes, spots):
    # The stand-in knows who is who: the first 10 people drawn are offense, as in `simulate`.
    return ["offense" if i < 10 else "defense" for i in range(len(spots))]


def test_follows_players_through_a_panning_camera_in_yards(tmp_path):
    frames, boxes, calibration, receivers, truth, _ = simulate(tmp_path)
    result = track_play(frames, boxes, calibration, jersey_team, FPS)
    tracks = {t["id"]: t for t in result["tracks"]}
    assert len(tracks) == len(boxes[0])
    for index, name in enumerate(receivers):
        got = tracks[index]["points"]
        # Followed all the way, not lost.
        assert len(got) >= FRAMES - 3, (name, len(got))
        errors = [np.hypot(x - truth[name][round(t * FPS)][0], y - truth[name][round(t * FPS)][1]) for t, x, y in got]
        # Within about a yard of where he really was, even as the camera moved ~10 yards.
        assert np.median(errors) < 0.8, (name, np.median(errors))
        assert max(errors) < 2.5, (name, max(errors))


def test_every_route_is_named_from_the_recovered_tracks(tmp_path):
    if shutil.which("node") is None:
        pytest.skip("node isn't installed")
    frames, boxes, calibration, receivers, truth, _ = simulate(tmp_path)
    result = track_play(frames, boxes, calibration, jersey_team, FPS)
    tracks_json = tmp_path / "tracks.json"
    tracks_json.write_text(json.dumps(result))
    out = subprocess.run(
        ["npx", "jiti", "scripts/read-routes.ts", str(tracks_json)],
        cwd=ROOT, capture_output=True, text=True, timeout=180, check=True,
    )
    reads = {r["id"]: r for r in json.loads(out.stdout)["reads"]}
    for index, (name, (kind, *_)) in enumerate(receivers.items()):
        assert reads[index]["route"] == kind, (name, reads[index])


def test_the_tracker_pairs_the_nearest_person_and_survives_a_missed_frame():
    start = [(0.0, 0.0), (10.0, 0.0)]
    frames = [
        [(0.0, 0.0), (10.0, 0.0)],
        [(0.0, 0.2), (10.1, 0.2)],
        [(10.2, 0.4)],  # the first player isn't found this frame
        [(0.0, 0.6), (10.3, 0.6)],
    ]
    tracks = follow(start, frames)
    assert [len(t.points) for t in tracks] == [3, 4]
    assert tracks[0].points[-1][1:] == (0.0, 0.6)


def test_without_holding_the_camera_still_the_paths_are_wrong(monkeypatch):
    """The control: the same clip with the camera motion ignored. If this passed the test above would prove nothing."""
    import eval.tracks as tracks_module

    frames, boxes, calibration, receivers, truth, _ = simulate(None)
    monkeypatch.setattr(tracks_module, "camera_to_snap", lambda grays, boxes, snap: [np.eye(3)] * (len(grays) - snap))
    result = tracks_module.track_play(frames, boxes, calibration, jersey_team, FPS)
    worst = []
    for index, name in enumerate(receivers):
        pts = {t["id"]: t for t in result["tracks"]}[index]["points"]
        errors = [np.hypot(x - truth[name][round(t * FPS)][0], y - truth[name][round(t * FPS)][1]) for t, x, y in pts]
        worst.append(max(errors))
    assert max(worst) > 5.0, worst

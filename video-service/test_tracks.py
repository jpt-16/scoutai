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
    monkeypatch.setattr(tracks_module, "camera_to_snap_paint", lambda frames: None)
    monkeypatch.setattr(tracks_module, "camera_to_snap", lambda grays, boxes, snap: [np.eye(3)] * (len(grays) - snap))
    result = tracks_module.track_play(frames, boxes, calibration, jersey_team, FPS)
    worst = []
    for index, name in enumerate(receivers):
        pts = {t["id"]: t for t in result["tracks"]}[index]["points"]
        errors = [np.hypot(x - truth[name][round(t * FPS)][0], y - truth[name][round(t * FPS)][1]) for t, x, y in pts]
        worst.append(max(errors))
    assert max(worst) > 5.0, worst


def test_a_smooth_camera_path_loses_its_jitter_but_keeps_its_motion():
    from eval.tracks import smooth_cameras

    rng = np.random.default_rng(5)
    truth = [np.array([[1, 0, 4.0 * i], [0, 1, -3.0 * i], [0, 0, 1]]) for i in range(60)]
    noisy = [np.array([[1, 0, 4.0 * i + rng.normal(0, 3)], [0, 1, -3.0 * i + rng.normal(0, 3)], [0, 0, 1]]) for i in range(60)]
    smooth = smooth_cameras(noisy, (1470, 816))

    def err(ms):
        return np.mean([abs(m[0, 2] - t[0, 2]) + abs(m[1, 2] - t[1, 2]) for m, t in zip(ms[5:-5], truth[5:-5])])

    assert err(smooth) < 0.6 * err(noisy)


def test_two_people_who_cross_keep_their_own_tracks_by_their_jerseys():
    # Two men run through each other's spot: one in red, one in blue.
    n = 12
    red = [(float(i) * 0.3, 0.0) for i in range(n)]
    blue = [(float(n - i) * 0.3, 0.05) for i in range(n)]
    per_frame = [[red[i], blue[i]] for i in range(n)]
    colors = [[(60.0, 160.0, 150.0), (120.0, 120.0, 90.0)] for _ in range(n)]
    tracks = follow(per_frame[0], per_frame, colors)
    assert [t.points[-1][1] for t in tracks] == [red[-1][0], blue[-1][0]]


def test_pictures_of_the_tracking_are_written_and_a_handed_off_track_is_reported(tmp_path):
    from eval.trackdebug import find_jumps, write_pictures

    frames, boxes, calibration, _receivers, _truth, _ = simulate(tmp_path)
    debug: dict = {}
    track_play(frames, boxes, calibration, jersey_team, FPS, debug)
    report = write_pictures(debug, tmp_path / "debug", "play_01")
    assert (tmp_path / "debug" / "play_01_trk_sheet.jpg").exists()
    assert (tmp_path / "debug" / "play_01_trk_0s.jpg").exists()
    assert any("pictures:" in line for line in report)
    # A clean simulated play has no hand-offs; one forced jump is found and named.
    assert not any(" jumped at " in line for line in report)
    points = [(i, 0.0, i * 0.2) for i in range(10)] + [(i, 9.0, i * 0.2 + 9.0) for i in range(10, 14)]
    assert [f for f, _ in find_jumps(points, FPS)] == [10]


def test_the_picture_draws_each_box_in_its_tracks_color_and_rings_a_jump():
    from eval.tracks import Track
    from eval.trackdebug import draw_frame, track_color

    boxes = [[(100.0, 100.0, 130.0, 180.0, 0.9), (300.0, 100.0, 330.0, 180.0, 0.9)] for _ in range(4)]
    # Frame 3: the second box is a different man than the track had (it was handed over).
    boxes[3][1] = (400.0, 220.0, 430.0, 300.0, 0.9)
    tracks = [
        Track(0, (0, 0), matched=[(f, 0) for f in range(4)]),
        Track(1, (3, 0), matched=[(f, 1) for f in range(4)]),
    ]
    frame = np.zeros((400, 600, 3), np.uint8)
    img = draw_frame(frame, boxes, tracks, ["offense", "defense"], 3, 30.0, {1: [3]})
    # The offense box's left edge is thick and in track 0's color; the jump circle is red at the new feet.
    assert tuple(int(v) for v in img[140, 100]) == track_color(0)
    ring = img[300 - 26, 415]
    assert tuple(int(v) for v in ring) == (0, 0, 255)
    # The trail from where track 1 had been to where it jumped is drawn between them.
    assert img[238:243, 363:368].any()


def test_a_lost_track_does_not_jump_to_a_man_standing_far_away():
    # One runner, missed for a while; a bench player stands still eight yards off. The track must not grab him.
    runner = [(0.3 * i, 0.0) for i in range(5)]
    snap = [(0.0, 0.0), (0.0, 8.0)]
    frames = [[(0.0, 0.0), (0.0, 8.0)]] + [[(x, y), (0.0, 8.0)] for x, y in runner[1:]] + [[(0.0, 8.0)]] * 8
    tracks = follow(snap, frames)
    assert max(y for _f, _x, y in tracks[0].points) < 1.0
    # He is found again where he would be, after the gap.
    later = [[(0.0, 8.0)]] * 3 + [[(0.3 * k, 0.0), (0.0, 8.0)] for k in range(5, 7)]
    again = follow(snap, [[(0.0, 0.0), (0.0, 8.0)]] + [[(x, y), (0.0, 8.0)] for x, y in runner[1:]] + later)
    assert again[0].points[-1][1] == pytest.approx(0.3 * 6, abs=0.01)


def test_a_box_cut_off_by_the_people_in_front_is_called_short_and_a_standing_man_is_not():
    from eval.people import feet_locator

    locate = feet_locator(np.diag([0.1, 0.1, 1.0]))  # 10 pixels a yard
    assert locate.short((100.0, 100.0, 108.0, 108.0, 0.9))  # 0.8 yards tall: a head and shoulders over the bench
    assert not locate.short((100.0, 100.0, 108.0, 120.0, 0.9))  # two yards tall: a man standing there


def test_a_recording_that_freezes_is_cut_where_it_stops_changing():
    from eval.tracks import unfrozen

    rng = np.random.default_rng(3)
    moving = [rng.integers(0, 255, (40, 60, 3), dtype=np.uint8) for _ in range(12)]
    frozen = [moving[-1].copy() for _ in range(20)]
    assert len(unfrozen(moving + frozen)) == 12
    assert len(unfrozen(moving)) == 12


def test_a_trail_is_drawn_where_the_man_went_on_the_field_not_where_the_camera_pointed():
    from eval.tracks import Track
    from eval.trackdebug import draw_frame

    # He stands still on the field while the camera pans 100 px: his raw boxes move, his trail must not.
    boxes = [[(100.0 + 20.0 * f, 100.0, 130.0 + 20.0 * f, 180.0, 0.9)] for f in range(6)]
    to_snap = [np.array([[1, 0, -20.0 * f], [0, 1, 0], [0, 0, 1]]) for f in range(6)]  # frame pixel -> snap pixel
    track = Track(0, (0, 0), matched=[(f, 0) for f in range(6)])
    frame = np.zeros((400, 600, 3), np.uint8)
    flat = draw_frame(frame, boxes, [track], ["offense"], 5, 4.0, {}, to_snap)
    raw = draw_frame(frame, boxes, [track], ["offense"], 5, 4.0, {}, None)
    # Compensated: no line (all the points are the same spot). Uncompensated: a line across 100 px.
    assert raw[178:182, 120:200].any()
    assert not flat[178:182, 120:195].any()

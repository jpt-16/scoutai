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
        assert reads[index]["route"] == ("fade" if kind == "go" else kind), (name, reads[index])  # go and fade are one route to this staff


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
    last = moving[-1]
    # A frozen picture still has a little compression noise.
    frozen = [np.clip(last.astype(int) + (rng.random(last.shape) < 0.05), 0, 255).astype(np.uint8) for _ in range(20)]
    assert len(unfrozen(moving + frozen)) == 12
    assert len(unfrozen(moving)) == 12
    # A pause in the middle (before the snap) is not cut: only stillness that lasts to the end is.
    pause = [moving[3].copy() for _ in range(10)]
    assert len(unfrozen(moving[:4] + pause + moving[4:])) == 22


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


def test_near_a_sideline_only_a_box_showing_a_whole_man_counts():
    from eval.people import FULL_BOX_RATIO, feet_locator

    locate = feet_locator(np.diag([0.1, 0.1, 1.0]))  # 10 pixels a yard: a standing man is 20 px tall
    assert locate.height_ratio((100.0, 100.0, 108.0, 120.0, 0.9)) >= FULL_BOX_RATIO  # a whole man
    bench = (100.0, 100.0, 108.0, 114.0, 0.9)  # chest-high over the row in front: 0.7 of a man
    assert not locate.short(bench)  # not "short" enough for the head rule...
    assert locate.height_ratio(bench) < FULL_BOX_RATIO  # ...but not a whole man either


def test_a_lost_track_is_not_picked_up_by_a_man_in_the_other_teams_jersey():
    white, navy = (85.0, 0.0, 0.0), (25.0, 5.0, -15.0)
    # He is lost for ten frames; a navy man stands three yards away the whole time and is the nearest after the gap.
    snap = [(0.0, 0.0), (6.0, 6.0)]
    colors0 = [white, navy]
    per_frame = [[(0.0, 0.0), (6.0, 6.0)]] + [[(6.0, 6.0), (3.0, 0.5)] for _ in range(10)] + [[(0.4, 0.2), (3.0, 0.5)]]
    colors = [colors0] + [[navy, navy] for _ in range(10)] + [[white, navy]]
    tracks = follow(snap, per_frame, colors)
    # The navy man at (3.0, 0.5) was never taken; the track came back only for the man in white.
    assert all(abs(x - 3.0) > 0.01 for _f, x, _y in tracks[0].points)
    assert tracks[0].points[-1][1] == pytest.approx(0.4, abs=0.01)
    # A man in shade (a little darker) is still him.
    shade = (65.0, 0.0, 0.0)
    again = follow(snap, per_frame, [colors0] + [[navy, navy] for _ in range(10)] + [[shade, navy]])
    assert again[0].points[-1][1] == pytest.approx(0.4, abs=0.01)


def test_a_tail_where_the_detector_sees_the_same_people_is_a_frozen_picture():
    from eval.tracks import frozen_from

    man = lambda x: (x, 100.0, x + 20.0, 140.0, 0.9)  # noqa: E731
    moving = [[man(10.0 + 5 * i), man(200.0)] for i in range(10)]
    still = [[man(55.0 + 0.5 * (k % 2)), man(200.0 + 0.3 * (k % 3))] for k in range(12)]
    assert frozen_from(moving + still) == 10
    assert frozen_from(moving) == len(moving)
    # A pause in the middle is not a tail.
    assert frozen_from(moving[:5] + still[:9] + moving[5:]) == 5 + 9 + 5
    # Faint boxes (the crowd) flicker in and out of a frozen picture: still frozen.
    flicker = [[man(55.0 + 40 * j) for j in range(8)] + ([man(500.0 + k)] if k % 2 else []) for k in range(12)]
    assert frozen_from(moving + flicker) == 11  # the first flicker frame itself differs from the last moving one


def test_the_detections_file_holds_every_person_in_every_frame(tmp_path):
    import json

    from eval.trackdebug import write_detections

    frames, boxes, calibration, _r, _t, _n = simulate(tmp_path)
    debug: dict = {}
    track_play(frames, boxes, calibration, jersey_team, FPS, debug)
    line = write_detections(debug, tmp_path / "det", "play_01")
    data = json.loads((tmp_path / "det" / "play_01_detections.json").read_text())
    assert data["fps"] == FPS and len(data["frames"]) == len(frames)
    first = data["frames"][0][0]
    assert set(first) == {"x", "y", "color", "score", "box"}
    assert len(data["frames"][0]) == len(boxes[0])
    assert "detections:" in line and len(data["tracks"]) == len(boxes[0])


def test_a_saved_raw_dump_replays_to_the_same_people_without_the_film(tmp_path):
    import json

    from eval.replay import replay
    from eval.trackdebug import write_detections

    frames, boxes, calibration, _r, _t, _n = simulate(tmp_path)
    debug: dict = {}
    track_play(frames, boxes, calibration, jersey_team, FPS, debug)
    write_detections(debug, tmp_path / "det", "play_01")
    dump = json.loads((tmp_path / "det" / "play_01_detections.json").read_text())
    again = replay(dump)
    # The same people in every frame as the live run found (positions and count), with no pixels used.
    assert [len(f) for f in again["per_frame"]] == [len(f) for f in debug["per_frame"]]
    for a, b in zip(again["per_frame"][0], debug["per_frame"][0]):
        assert abs(a[0] - b[0]) < 0.05 and abs(a[1] - b[1]) < 0.05


def test_the_tracklet_tracker_follows_the_drawn_receivers_too(tmp_path):
    frames, boxes, calibration, receivers, truth, _ = simulate(tmp_path)
    result = track_play(frames, boxes, calibration, jersey_team, FPS, tracker="tracklets")
    tracks = {t["id"]: t for t in result["tracks"]}
    assert len(tracks) >= len(boxes[0])
    for index, name in enumerate(receivers):
        got = tracks[index]["points"]
        assert len(got) >= FRAMES - 3, (name, len(got))
        errors = [np.hypot(x - truth[name][round(t * FPS)][0], y - truth[name][round(t * FPS)][1]) for t, x, y in got]
        assert np.median(errors) < 0.8, (name, np.median(errors))
        assert max(errors) < 2.5, (name, max(errors))


def test_standing_people_beside_a_sideline_are_dropped_and_a_runner_is_kept():
    from eval.tracks import drop_standing_sideline

    # Ball at 26.7 across, direction +1: view x = across - 26.7. The far sideline is across = 0, so x = -26.7.
    frames = 80
    bench = (-25.0, 3.0)  # 1.7 yd from the sideline, never moves
    runner = lambda f: (-22.0 + 0.1 * f, 3.0)  # starts wide and runs in
    mid = (5.0, 3.0)  # standing mid-field is a player (a lineman)
    per_frame = [[bench, runner(f), mid] for f in range(frames)]
    boxes = [[(0, 0, 1, 1, 1.0)] * 3 for _ in range(frames)]
    colors = [[(0.0, 0.0, 0.0)] * 3 for _ in range(frames)]
    drop_standing_sideline(per_frame, boxes, colors, 26.7, 1)
    assert all(len(p) == 2 for p in per_frame)
    assert all(bench not in p for p in per_frame)
    assert all(mid in p for p in per_frame)


def test_a_track_is_cut_where_it_runs_into_the_strip_beside_a_sideline():
    from eval.tracks import Track, trim_at_sideline

    # Across = 26.7 + x. A receiver runs from 12 yd inside the far sideline to 1 yd from it.
    pts = [(f, -14.7 - 0.2 * f, 5.0) for f in range(60)]
    t = Track(0, (pts[0][1], pts[0][2]), list(pts), matched=[(f, 0) for f in range(60)])
    trim_at_sideline([t], 26.7, 1)
    gap = lambda p: 26.7 + p[1]
    assert gap(t.points[-1]) >= 4.0 > gap(pts[len(t.points)])
    assert len(t.points) == len(t.matched) < 60
    # A man who started inside the strip is left alone.
    pts = [(f, -25.0 + 0.01 * f, 5.0) for f in range(30)]
    s = Track(1, (pts[0][1], pts[0][2]), list(pts), matched=[(f, 0) for f in range(30)])
    trim_at_sideline([s], 26.7, 1)
    assert len(s.points) == 30


def test_a_crowd_beside_a_sideline_is_not_players_but_a_bunch_formation_is():
    from eval.people import sideline_crowd

    bench = [(51.5, 20.0 + 0.8 * i) for i in range(8)]
    assert sideline_crowd(bench) == set(range(8))
    # A receiver 5 yd in, in front of that bench, is a player.
    assert sideline_crowd(bench + [(48.0, 22.0)]) == set(range(8))
    # Three receivers bunched beside the sideline, and a line in the middle of the field, are players.
    bunch = [(49.0, 20.0), (50.0, 21.5), (48.5, 22.0)]
    line = [(26.0 + 1.5 * i, 20.0) for i in range(5)]
    assert sideline_crowd(bunch + line) == set()

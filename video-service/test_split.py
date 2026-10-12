"""eval/split.py: finding the plays in a long video.

Two kinds of test. Arrays: the rules (a quiet set then a burst, on grass, no cut at the snap, not into the next
play) on hand-built motion series. And a drawn game film: minutes of a field with players standing about, plays
(a still set, then everyone moving, the camera following), a crowd cutaway with hard cuts, slow pans between
plays; the splitter must find each snap, ignore the cutaway, and cut clips the rest of the pipeline can read.
"""

import json
from pathlib import Path

import cv2
import numpy as np
import pytest

import synthfield as sf
from eval import split
from eval.split import Play, Series, cut_clips, find_plays, plot, read_series, split_video

SR = 5.0  # the series' sample rate


def series(motion, green=None, cut=None) -> Series:
    n = len(motion)
    return Series(
        SR,
        np.array(motion, float),
        np.full(n, 0.6) if green is None else np.array(green, float),
        np.zeros(n, bool) if cut is None else np.array(cut, bool),
        n / SR,
    )


def timeline(total_s: float, bursts: list[tuple[float, float]], quiet=0.1, loud=3.0):
    """Motion that is `quiet` everywhere except `loud` over each (start, seconds) burst."""
    m = np.full(int(total_s * SR), quiet)
    for start, length in bursts:
        m[int(start * SR) : int((start + length) * SR)] = loud
    return m


# ------------------------------------------------------------------ the rules, on arrays


def test_a_quiet_set_then_a_burst_is_a_snap_and_the_clip_keeps_the_set_before_it():
    plays = find_plays(series(timeline(120, [(30, 6), (70, 6)])))
    assert [round(p.snap) for p in plays] == [30, 70]
    for p, at in zip(plays, (30, 70)):
        assert p.start == pytest.approx(at - split.PRE_SECONDS, abs=0.4)
        assert at + split.MIN_AFTER_SECONDS <= p.end <= at + split.MAX_AFTER_SECONDS + split.TAIL_SECONDS + 0.5
        assert p.score > 0.5


def test_motion_that_never_settles_is_not_a_snap():
    # a camera that keeps moving: loud all the time, so there is no quiet set before anything
    assert find_plays(series(np.full(600, 2.5))) == []
    assert find_plays(series(np.full(600, 0.1))) == []


def test_a_burst_that_follows_continuous_motion_is_not_a_second_snap():
    m = timeline(120, [(30, 6)])
    m[int(20 * SR) : int(30 * SR)] = 2.0  # busy from 20 s right up to the burst (a scramble, a pan)
    plays = find_plays(series(m))
    # the busy stretch begins out of a quiet set, so that is the one snap; the burst inside it has no quiet before it
    assert [round(p.snap) for p in plays] == [20]


def test_footage_that_is_not_the_field_is_ignored_and_does_not_set_the_scale():
    m = timeline(150, [(30, 6), (90, 6)], loud=3.0)
    green = np.full(len(m), 0.6)
    green[int(80 * SR) : int(110 * SR)] = 0.02  # a crowd shot and a graphic over the second play
    m[int(85 * SR) : int(110 * SR)] = np.maximum(m[int(85 * SR) : int(110 * SR)], 9.0)  # loud, but not the field
    plays = find_plays(series(m, green))
    assert [round(p.snap) for p in plays] == [30]


def test_a_hard_cut_at_the_snap_means_the_set_was_not_seen():
    m = timeline(120, [(30, 6), (70, 6)])
    cut = np.zeros(len(m), bool)
    cut[int(70 * SR)] = True  # the camera changed right at the second snap
    plays = find_plays(series(m, cut=cut))
    assert [round(p.snap) for p in plays] == [30]


def test_two_bursts_closer_than_the_gap_are_one_play():
    plays = find_plays(series(timeline(120, [(30, 3), (36, 3)])))
    assert len(plays) == 1


def test_a_play_never_runs_into_the_next_sets():
    plays = find_plays(series(timeline(120, [(30, 6), (45, 6)], quiet=0.1)))
    assert len(plays) == 2
    assert plays[0].end <= plays[1].start - 0.1  # the first clip stops before the second one's set begins


def test_a_burst_that_stops_early_ends_the_clip_near_where_it_stopped():
    plays = find_plays(series(timeline(120, [(30, 3)])))
    assert plays[0].end == pytest.approx(30 + split.MIN_AFTER_SECONDS + split.TAIL_SECONDS, abs=1.0)
    long = find_plays(series(timeline(120, [(30, 30)])))
    assert long[0].end - long[0].snap <= split.MAX_AFTER_SECONDS + split.TAIL_SECONDS + 0.5


def test_too_short_a_film_or_no_field_gives_nothing():
    assert find_plays(series([0.1] * 5)) == []
    assert find_plays(series(timeline(120, [(30, 6)]), green=np.full(600, 0.01))) == []


# ------------------------------------------------------------------ a drawn game film

W, H, FPS = 640, 360, 30


def base_frame() -> np.ndarray:
    frame, _ = sf.render(sf.QUAD_A)
    return cv2.resize(frame, (W, H), interpolation=cv2.INTER_AREA)


# (kind, seconds). The truth: a snap is where a "play" segment starts.
SCRIPT = [
    ("dead", 9), ("set", 3), ("play", 6),
    ("dead", 22), ("crowd", 9), ("dead", 14), ("set", 3), ("play", 6),
    ("dead", 26), ("set", 3), ("play", 6),
    ("dead", 16), ("crowd", 6), ("dead", 12), ("set", 3), ("play", 6),
    ("dead", 10),
]


def snap_times() -> list[float]:
    t, out = 0.0, []
    for kind, seconds in SCRIPT:
        if kind == "play":
            out.append(t)
        t += seconds
    return out


def render_game(path: Path, seed: int = 5) -> None:
    rng = np.random.default_rng(seed)
    base = base_frame()
    offense = [(220 + 28 * i, 232) for i in range(7)] + [(300, 262), (350, 262), (320, 285), (270, 256)]
    defense = [(215 + 30 * i, 205) for i in range(7)] + [(240, 170), (320, 165), (400, 168), (300, 130)]
    out = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    jitter = rng.normal(0, 0.15, (len(offense) + len(defense), 2))
    for kind, seconds in SCRIPT:
        for f in range(int(seconds * FPS)):
            t = f / FPS
            if kind == "crowd":
                if f % 15 == 0:  # new blocks of crowd colors twice a second, with a hard cut at each change
                    crowd = rng.integers(40, 230, (9, 16, 3)).astype(np.uint8)
                    crowd[:, :, 1] = (crowd[:, :, 1] * 0.5).astype(np.uint8)  # not green
                    crowd[:, :, 2] = np.clip(crowd[:, :, 2].astype(int) + 60, 0, 255).astype(np.uint8)
                frame = cv2.resize(crowd, (W, H), interpolation=cv2.INTER_NEAREST)
                out.write(frame)
                continue
            # a slow pan between plays; the camera follows the play once it starts
            pan_x = 2.0 * np.sin(t / 7.0) if kind == "dead" else 0.0
            if kind == "play":
                pan_x = 18.0 * t
            m = np.float32([[1, 0, -pan_x], [0, 1, 0]])
            frame = cv2.warpAffine(base, m, (W, H), borderMode=cv2.BORDER_REPLICATE)
            drift = 0.0 if kind in ("set", "dead") else 1.0
            for i, (x, y) in enumerate(offense):
                dy = -42.0 * t * drift
                dx = (12.0 * t if i % 2 else -12.0 * t) * drift
                px, py = x + dx + jitter[i, 0] * (f % 7) - pan_x * drift * 0, y + dy + jitter[i, 1] * (f % 5)
                cv2.rectangle(frame, (int(px) - 5, int(py) - 22), (int(px) + 5, int(py)), (230, 230, 235), -1)
            for i, (x, y) in enumerate(defense):
                dy = 30.0 * t * drift
                px, py = x + jitter[11 + i, 0] * (f % 7), y + dy + jitter[11 + i, 1] * (f % 5)
                cv2.rectangle(frame, (int(px) - 5, int(py) - 22), (int(px) + 5, int(py)), (90, 40, 30), -1)
            out.write(frame)
    out.release()


@pytest.fixture(scope="module")
def game(tmp_path_factory) -> Path:
    path = tmp_path_factory.mktemp("game") / "half.mp4"
    render_game(path)
    return path


def test_the_film_reads_at_a_few_samples_a_second_with_cuts_and_grass_marked(game):
    s = read_series(game)
    assert s.sample_fps == pytest.approx(5.0, abs=0.1)
    assert s.duration == pytest.approx(sum(sec for _, sec in SCRIPT), abs=1.0)
    crowd_start = int(sum(sec for k, sec in SCRIPT[:4]) * s.sample_fps)
    assert s.green[int(5 * s.sample_fps)] > split.GREEN_MIN  # the field
    assert s.green[crowd_start + 10] < split.GREEN_MIN  # the crowd
    assert s.cut[crowd_start : crowd_start + 20].any()


def test_every_snap_in_the_game_is_found_and_the_crowd_and_dead_time_are_not(game):
    plays, series_ = split_video(game)
    truth = snap_times()
    assert len(plays) == len(truth), [round(p.snap, 1) for p in plays]
    for p, t in zip(plays, truth):
        assert abs(p.snap - t) <= 0.9, (p.snap, t)
        assert p.green > split.GREEN_MIN
    # clips don't overlap and each is long enough to hold a play
    for a, b in zip(plays, plays[1:]):
        assert a.end <= b.start
    assert all(p.end - p.start >= split.PRE_SECONDS + split.MIN_AFTER_SECONDS for p in plays)


def test_clips_are_cut_numbered_and_readable(game, tmp_path):
    plays, _ = split_video(game)
    paths = cut_clips(game, plays, tmp_path / "clips", first_number=5)
    assert [p.name for p in paths] == ["play_005.mp4", "play_006.mp4", "play_007.mp4", "play_008.mp4"]
    for p, play in zip(paths, plays):
        cap = cv2.VideoCapture(str(p))
        frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()
        assert frames == pytest.approx((play.end - play.start) * FPS, abs=FPS * 0.6)
    # the cut clip, split again, has its snap where the plan said: PRE_SECONDS in
    again, _ = split_video(paths[0])
    assert again == [] or abs(again[0].snap - (plays[0].snap - plays[0].start)) <= 1.0


def test_a_plan_and_a_picture_of_the_motion_are_written(game, tmp_path):
    plays, series_ = split_video(game)
    png = tmp_path / "energy.png"
    plot(series_, plays, png)
    img = cv2.imread(str(png))
    assert img is not None and img.shape[1] == 1800
    assert (img[:, :, 2] > 200).any()  # the orange marks are there


def test_a_file_that_is_not_a_video_is_refused(tmp_path):
    bad = tmp_path / "x.mp4"
    bad.write_bytes(b"not a video")
    with pytest.raises(ValueError):
        read_series(bad)


def test_the_command_line_finds_cuts_and_writes_the_plan(game, tmp_path, monkeypatch, capsys):
    import sys

    monkeypatch.setattr(sys, "argv", ["split", str(game), "--out", str(tmp_path / "c"), "--plan", str(tmp_path / "plan.json"), "--first", "10"])
    split.main()
    plan = json.loads((tmp_path / "plan.json").read_text())
    assert len(plan["plays"]) == 4 and {"start", "snap", "end", "score", "green"} <= set(plan["plays"][0])
    assert sorted(p.name for p in (tmp_path / "c").glob("*.mp4")) == ["play_010.mp4", "play_011.mp4", "play_012.mp4", "play_013.mp4"]
    assert "4 plays" in capsys.readouterr().out

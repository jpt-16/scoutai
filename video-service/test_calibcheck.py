"""The calibration self-check must pass a level line and catch a skewed one."""

import numpy as np

from eval.calibcheck import check_line, check_tracks


def line(tilt_yards=0.0, jitter=0.15, seed=1):
    rng = np.random.default_rng(seed)
    xs = [-4.0, -2.0, 0.0, 2.0, 4.0]
    return [(x, -1.0 + tilt_yards * (x / 8.0) + rng.normal(0, jitter)) for x in xs] + [(14.0, -1.0), (0.0, -5.0)]


def test_level_line_passes():
    assert check_line(line())["ok"]


def test_skewed_field_is_caught():
    r = check_line(line(tilt_yards=4.0))
    assert not r["ok"] and "tilted" in r["why"]


def test_too_few_men_is_not_trusted():
    r = check_line([(0.0, -1.0), (2.0, -1.0), (14.0, -5.0)])
    assert not r["ok"] and "only" in r["why"]


def test_reads_a_tracks_file():
    pts = lambda x, y: [[t / 10, x, y] for t in range(0, 30)]
    tracks = {"formations": {"snapSeconds": 1.0}, "tracks": [{"team": "offense", "points": pts(x, -1.0)} for x in (-4, -2, 0, 2, 4)]}
    assert check_tracks(tracks)["ok"]

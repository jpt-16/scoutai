"""A coach's taps: a tap finds a detected man, names his track (or starts one), and never guesses when nobody is there."""

import numpy as np

from eval.boxtrack import follow_boxes
from eval.taps import Tap, read_taps, resolve


def box(cx: float, bottom: float, h: float = 60.0):
    return (cx - h * 0.2, bottom - h, cx + h * 0.2, bottom)


IDENTITY = np.eye(3)


def test_read_taps_makes_frames_relative_and_drops_unknown_letters():
    taps = read_taps({"frame": 112, "taps": {"x": [10, 20], "Y": [30, 40], "Q": [1, 2], "LB": [5, 5], "Z": "nope"}}, start=100)
    assert sorted((t.letter, t.frame) for t in taps) == [("Q", 12), ("X", 12), ("Y", 12)]


def test_a_tap_can_carry_its_own_frame():
    taps = read_taps({"frame": 112, "taps": {"X": [10, 20], "H": [30, 40, 118]}}, start=100)
    assert sorted((t.letter, t.frame) for t in taps) == [("H", 18), ("X", 12)]


def test_a_tap_lands_on_the_box_it_is_in_or_nearest_and_says_when_nobody_is_there():
    warped = [[box(300, 300), box(500, 300)] for _ in range(10)]
    forced, notes = resolve([Tap("X", 3, 305, 270), Tap("Y", 3, 500, 250), Tap("Z", 3, 900, 100)], warped, [IDENTITY] * 10)
    assert forced == [(3, 0, "X"), (3, 1, "Y")]
    assert notes == ["Z: nobody found near the tap"]


def test_a_man_the_detector_missed_on_the_tap_frame_is_found_a_frame_or_two_later():
    warped = [[box(300, 300)] if f not in (3, 4) else [] for f in range(10)]
    forced, _ = resolve([Tap("H", 3, 300, 270)], warped, [IDENTITY] * 10)
    assert forced == [(2, 0, "H")]  # frames 3 and 4 have nobody; the nearest frame with a man there is 2 (looked at before 5)


def test_a_tap_names_the_track_that_already_follows_the_man_and_keeps_following_him():
    boxes = [[box(300 + 2 * f, 300), box(600, 300)] for f in range(30)]
    spots = [[(0.1 * f, 0.0), (20.0, 0.0)] for f in range(30)]
    tracks = follow_boxes(boxes, spots, forced=[(10, 0, "Z")])
    z = [t for t in tracks if t.label == "Z"]
    assert len(z) == 1 and len(z[0].matched) == 30 and all(j == 0 for _, j in z[0].matched)


def test_a_tap_on_a_man_nobody_follows_starts_his_track_even_if_his_jersey_reads_too_little_to_be_seeded():
    boxes, spots, shares = [], [], []
    for f in range(30):
        b, s, sh = [box(500, 300), box(540, 300), box(580, 300)], [(-1.0, -1.0), (0.0, -1.0), (1.0, -1.0)], [0.4, 0.4, 0.4]
        if f >= 5:  # a far receiver the detector first finds at frame 5, his jersey reading too little of the color to be seeded alone
            b, s, sh = b + [box(150 + f, 280)], s + [(-12.0, 0.0)], sh + [0.03]
        boxes.append(b), spots.append(s), shares.append(sh)
    tracks = follow_boxes(boxes, spots, shares, forced=[(6, 3, "X")])
    x = [t for t in tracks if t.label == "X"]
    assert len(x) == 1 and x[0].seeded == (6, 3) and len(x[0].matched) == 24  # frames 6..29
    # Without the tap he gets no track at all (too little of the jersey's color to start one).
    assert not [t for t in follow_boxes(boxes, spots, shares) if t.seeded is not None and t.points[0][1] < -5]


def test_a_tap_on_a_man_whose_track_was_just_lost_continues_that_track():
    """One man, found at frames 0-9, missed 10-15 (the box he comes back in is yards from where he was heading), found again at 16:
    the tap on him at 16 continues his track instead of starting a second one."""
    boxes, spots = [], []
    for f in range(30):
        if 10 <= f < 16:
            boxes.append([]), spots.append([])
        else:
            boxes.append([box(300 + (14 * f if f >= 16 else 2 * f), 300)])
            spots.append([(0.1 * f, 0.0)])
    tracks = follow_boxes(boxes, spots, forced=[(16, 0, "H")])
    assert len(tracks) == 1 and tracks[0].label == "H" and len(tracks[0].matched) == 24


def test_two_taps_on_one_box_follow_him_once_and_say_so():
    boxes = [[box(300, 300), box(600, 300)] for _ in range(20)]
    spots = [[(0.0, 0.0), (20.0, 0.0)] for _ in range(20)]
    tracks = follow_boxes(boxes, spots, forced=[(5, 0, "Y"), (5, 0, "Z")])
    y = next(t for t in tracks if t.label == "Y")
    assert y.shared == ["Z"] and not [t for t in tracks if t.label == "Z"]

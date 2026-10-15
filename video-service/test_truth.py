"""eval.truth: a man's track is the one on him at his first tracked mark, never a track yards away."""

from eval.truth import found, score


def tracks(*points_lists):
    return {"fps": 30.0, "tracks": [{"team": "offense", "points": pts} for pts in points_lists]}


def test_a_mark_in_a_gap_does_not_hand_him_to_a_track_yards_away():
    him = [[f / 30, -12.0, f * 0.1] for f in range(20, 90)]  # his track starts after his first mark (a gap at the snap)
    other = [[f / 30, -4.0, 0.0] for f in range(0, 90)]  # a lineman, 8 yd off, on the field the whole time
    truth = {"men": {"X": {"10": [-12.0, 1.0], "30": [-12.0, 3.0], "60": [-12.0, 6.0], "85": [-12.0, 8.5]}}}
    right, total, lines = score(tracks(him, other), truth)
    assert (right, total) == (3, 3), lines  # his track is on him at 30 (where it pins him), 60 and 85; never the lineman
    # Nothing on him at all: every later mark is missing, none wrong.
    right, total, lines = score(tracks(other), truth)
    assert (right, total) == (0, 3) and "wrong" not in lines[0]


def test_found_counts_a_raw_box_on_him():
    spots = [[(-12.0, 0.0)], [], [(-11.5, 0.5), (3.0, 0.0)]]
    assert found(spots, {"men": {"X": {"0": [-12.0, 0.0], "1": [-12.0, 0.0], "2": [-12.0, 0.0]}}}) == {"X": (2, 3)}

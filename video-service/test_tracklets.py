"""The tracklet tracker (eval/tracklets.py) on drawn data: positions in yards and jersey signatures, no film."""

import numpy as np

from eval.tracklets import follow_tracklets, jersey_signature, team_prototypes, team_score

WHITE = np.array([0.0, 0.1, 0.3, 0.6, 0, 0, 0, 0, 0, 0], np.float32)
NAVY = np.array([0.6, 0.2, 0.1, 0.0, 0.1, 0, 0, 0, 0, 0], np.float32)
GREY = np.array([0.0, 0.2, 0.7, 0.1, 0, 0, 0, 0, 0, 0], np.float32)


def play(men, frames=60, drop=None):
    """`men`: (team signature, path function f -> (x, y)). `drop(f, i)`: the detector missed man i in frame f."""
    per_frame, sigs = [], []
    for f in range(frames):
        people, ss = [], []
        for i, (sig, path) in enumerate(men):
            if drop and drop(f, i):
                continue
            people.append(path(f))
            ss.append(sig)
        per_frame.append(people)
        sigs.append(ss)
    return per_frame, sigs


def track_through(followed, at_frame, near):
    """The man whose track is nearest `near` at `at_frame`."""
    best = None
    for t in followed:
        for f, x, y in t.points:
            if f == at_frame:
                d = np.hypot(x - near[0], y - near[1])
                if best is None or d < best[0]:
                    best = (d, t)
    return best


def test_teams_are_told_apart_by_jersey():
    protos = team_prototypes([(0, -2), (5, -1), (0, 5), (4, 6)], [WHITE, WHITE, NAVY, NAVY])
    assert team_score(WHITE, protos) > 0.5
    assert team_score(NAVY, protos) < -0.5


def test_a_receiver_is_not_handed_to_the_defender_covering_him():
    # Receiver (white) runs a fade up x=10; the corner (navy) starts 6 yards off and runs with him stride for stride, a
    # yard inside, crossing onto the receiver's line halfway (the case where the first tracker swapped them).
    receiver = (WHITE, lambda f: (10.0, -1.0 + 0.3 * f))
    corner = (NAVY, lambda f: (9.0 + min(1.0, max(0.0, (f - 20) / 10)), 5.0 + 0.2 * f))
    others = [(WHITE, lambda f, x=x: (x, -1.0)) for x in (-2.0, 0.0, 2.0)] + [(NAVY, lambda f, x=x: (x, 3.0)) for x in (-1.0, 1.0)]
    per_frame, sigs = play([receiver, corner, *others], frames=60, drop=lambda f, i: i == 0 and 28 <= f <= 33)
    followed = follow_tracklets(per_frame, sigs)
    him = next(t for t in followed if t.team == "offense" and abs(t.start[0] - 10.0) < 0.1)
    for f, x, y in him.points:
        assert abs(y - (-1.0 + 0.3 * f)) < 0.6, f"frame {f}: the receiver's track is at {(x, y)}"
    assert him.points[-1][0] == 59


def test_a_man_missed_for_a_third_of_a_second_is_found_again():
    receiver = (WHITE, lambda f: (-12.0 - 0.02 * f, -1.0 + 0.3 * f))
    slot = (WHITE, lambda f: (-8.0 + 0.05 * min(f, 15), -1.0 + 0.25 * min(f, 15)))  # a hitch: stem, then stop
    per_frame, sigs = play([receiver, slot], frames=60, drop=lambda f, i: i == 0 and 20 <= f <= 30)
    followed = follow_tracklets(per_frame, sigs)
    found = track_through(followed, 50, (-13.0, 14.0))
    assert found and found[0] < 0.5 and abs(found[1].start[0] - (-12.0)) < 0.1


def test_people_never_seen_at_the_snap_are_not_followed():
    # A white bench player who only walks onto the picture a second in, far from anyone on the field.
    men = [(WHITE, lambda f: (0.0, -1.0)), (NAVY, lambda f: (0.0, 3.0))]
    per_frame, sigs = play(men, frames=60)
    for f in range(30, 60):
        per_frame[f].append((22.0, 10.0))
        sigs[f].append(WHITE)
    followed = follow_tracklets(per_frame, sigs)
    assert len(followed) == 2


def test_the_signature_reads_a_white_and_a_navy_jersey():
    frame = np.zeros((100, 100, 3), np.uint8)
    frame[:, :50] = (245, 245, 245)  # white
    frame[:, 50:75] = (40, 20, 12)  # navy in shade (BGR): too dark for a hue
    frame[:, 75:] = (90, 45, 25)  # navy in the sun: blue
    white = jersey_signature(frame, (0, 0, 50, 100))
    shade = jersey_signature(frame, (50, 0, 75, 100))
    sun = jersey_signature(frame, (75, 0, 100, 100))
    assert white[3] > 0.9 and shade[0] > 0.9 and sun[4 + 3] > 0.9

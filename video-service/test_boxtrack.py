"""The box tracker: a man is continued by the box that overlaps his, not by whoever's feet land nearest in yards."""

import numpy as np

from eval import boxtrack
from eval.boxtrack import follow_boxes, iou, smoothed, warp_boxes


def box(cx: float, bottom: float, h: float = 60.0) -> tuple[float, float, float, float]:
    return (cx - h * 0.2, bottom - h, cx + h * 0.2, bottom)


def test_far_side_jitter_in_yards_does_not_swap_two_men_whose_boxes_stay_apart():
    """Two far receivers 2 yd apart whose spots in yards jump 2 yd a frame (a box bottom a few pixels off, far away), while their
    boxes, 40 px apart, barely move: each track keeps its own man."""
    rng = np.random.default_rng(3)
    boxes, spots = [], []
    for f in range(60):
        a, b = box(400 + f, 300 + rng.normal(0, 1.5)), box(440 + f, 300 + rng.normal(0, 1.5))
        boxes.append([a, b] if f % 2 else [b, a])  # the detector lists them in either order
        ya, yb = 10 + rng.normal(0, 1.2), 12 + rng.normal(0, 1.2)  # yards: noisy enough that nearest-in-yards swaps them
        spots.append([(ya, 0.0), (yb, 0.0)] if f % 2 else [(yb, 0.0), (ya, 0.0)])
    tracks = follow_boxes(boxes, spots)
    for t in tracks:
        xs = {round((boxes[f][j][0] + boxes[f][j][2]) / 2 - f) for f, j in t.matched}
        assert len(xs) == 1, "a track changed men"
        assert len(t.matched) == 60


def test_a_track_of_the_scouted_team_never_takes_a_box_not_wearing_its_color():
    """A red receiver lost behind a gold defender: the defender's box sits where his was heading, and is refused."""
    boxes, spots, shares = [], [], []
    for f in range(30):
        if f < 10:
            boxes.append([box(300 + 2 * f, 300)])
            shares.append([0.35])
        else:  # only the defender is found, right where the receiver was going
            boxes.append([box(300 + 2 * f, 300)])
            shares.append([0.0])
        spots.append([(float(f), 0.0)])
    track = follow_boxes(boxes, spots, shares)[0]
    assert max(f for f, _ in track.matched) == 9, "the receiver's track took the defender"
    # Without the color, the same box is taken: the gate is what keeps him off.
    assert max(f for f, _ in follow_boxes(boxes, spots)[0].matched) == 29


def test_after_a_gap_he_is_found_near_where_he_was_heading_but_not_a_box_height_away():
    boxes, spots = [], []
    for f in range(20):
        if 8 <= f < 13:
            boxes.append([])
            spots.append([])
        elif f >= 13:
            # him, a few pixels on from where he was going, and someone else a box height away
            boxes.append([box(300 + 3 * f + 4, 300), box(300 + 3 * f + 60, 300)])
            spots.append([(0.25 * f, 0.0), (0.25 * f + 3, 0.0)])  # 7.5 yd/s
        else:
            boxes.append([box(300 + 3 * f, 300)])
            spots.append([(0.25 * f, 0.0)])
    track = follow_boxes(boxes, spots)[0]
    later = [j for f, j in track.matched if f >= 13]
    assert later and set(later) == {0}


def test_overlap_and_warp():
    assert abs(iou((0, 0, 10, 10), (0, 0, 10, 10)) - 1.0) < 1e-6
    assert iou((0, 0, 10, 10), (20, 20, 30, 30)) == 0.0
    shift = np.array([[1, 0, 5], [0, 1, -3], [0, 0, 1]], dtype=np.float64)
    assert warp_boxes([(10, 20, 30, 60, 0.9)], np.eye(3))[0] == (10.0, 20.0, 30.0, 60.0)
    assert warp_boxes([(10, 20, 30, 60, 0.9)], shift)[0] == (15.0, 17.0, 35.0, 57.0)


def test_smoothing_takes_out_the_box_edge_jitter_and_keeps_the_path():
    rng = np.random.default_rng(0)
    raw = [(f, 0.3 * f + rng.normal(0, 1.0), 5.0 + rng.normal(0, 0.2)) for f in range(40)]
    smooth = smoothed(raw)
    assert [p[0] for p in smooth] == [p[0] for p in raw]
    err = lambda pts: float(np.mean([abs(x - 0.3 * f) for f, x, _ in pts[5:-5]]))  # noqa: E731
    assert err(smooth) < err(raw) / 2
    assert boxtrack.SMOOTH_MEDIAN >= 3 and boxtrack.SMOOTH_MEAN >= 3


def test_feet_from_the_box_middle_and_a_steady_height_are_steadier_than_its_bottom_edge():
    """A man walking straight across the picture whose box bottom jitters 6 px (legs, blur) while its top and middle hold."""
    rng = np.random.default_rng(1)
    boxes, spots = [], []
    for f in range(60):
        top = 200.0 + rng.normal(0, 1)
        bottom = 300.0 + rng.normal(0, 6)
        boxes.append([(100 + 2 * f - 15, top, 100 + 2 * f + 15, bottom)])
        spots.append([(0.1 * f, bottom / 10)])  # what the old feet (the box's bottom) would give, in "yards"
    locate = lambda x, y: (x / 20, y / 10)  # noqa: E731
    steady = follow_boxes(boxes, spots, None, locate)[0].points
    rough = lambda pts: float(np.mean(np.abs(np.diff([y for _, _, y in pts], 2))))  # noqa: E731
    assert rough(steady) < rough(follow_boxes(boxes, spots)[0].points) * 0.7  # both are smoothed after; still a third steadier
    assert all(abs(y - 30.0) < 1.0 for _, _, y in steady[5:-5])  # his feet, at the height the box really has


def test_the_gate_follows_the_scouted_teams_color():
    """White: a navy defender can read as much white as a receiver (numbers, pants), so `scoutteam.color_share` gives a torso with
    near-black on it 0 white (`DARK_NOT`), and the gate only has to refuse that; a far, blurred white receiver reading 0.04 white
    with no near-black (play 66's X) is still him."""
    from eval.scoutteam import wear_gate

    def run(later: float) -> int:
        boxes, spots, shares = [], [], []
        for f in range(30):
            boxes.append([box(300 + 2 * f, 300)])
            shares.append([0.3 if f < 10 else later])
            spots.append([(float(f), 0.0)])
        return max(f for f, _ in follow_boxes(boxes, spots, shares, gate=wear_gate("white"))[0].matched)

    assert run(0.0) == 9  # the defender (0 white once his near-black is seen): refused
    assert run(0.04) == 29  # the receiver, far and blurred: kept
    assert wear_gate("Red") == wear_gate("gold") == (boxtrack.WEARS, boxtrack.NOT_WEARS)


def _frame0_with_offense(f):
    """Three red linemen behind the ball and three gold defenders past it (so the scouted team's side is known)."""
    return (
        [box(500, 300), box(540, 300), box(580, 300), box(500, 230), box(540, 230), box(580, 230)],
        [(-1.0, -1.0), (0.0, -1.0), (1.0, -1.0), (-1.0, 4.0), (0.0, 4.0), (1.0, 4.0)],
        [0.4, 0.4, 0.4, 0.0, 0.0, 0.0],
    )


def test_a_split_receiver_the_detector_missed_on_frame_0_is_followed_from_when_he_turns_up():
    """Play 66's far X was missed on the first frame and so never followed. A receiver in the scouted color, split wide on the
    offense's side of the ball, who turns up at frame 5 gets his own track from there; one standing 9 yards past the line, or one
    among the linemen, does not."""
    boxes, spots, shares = [], [], []
    for f in range(40):
        b, s, sh = _frame0_with_offense(f)
        if f >= 5:
            b, s, sh = b + [box(150 + 2 * f, 280)], s + [(-12.0, 0.1 * f)], sh + [0.3]  # the receiver
            b, s, sh = b + [box(900, 200)], s + [(8.0, 9.0)], sh + [0.3]  # red, but past the line
        boxes.append(b), spots.append(s), shares.append(sh)
    tracks = follow_boxes(boxes, spots, shares)
    late = [t for t in tracks if t.seeded is not None]
    assert len(late) == 1
    assert late[0].seeded == (5, 6) and len(late[0].matched) == 35
    # Seeding stops after `SEED_FRAMES`.
    assert not [t for t in follow_boxes(boxes, spots, shares, seed_frames=3) if t.seeded is not None]


def test_a_late_flicker_is_not_kept():
    boxes, spots, shares = [], [], []
    for f in range(40):
        b, s, sh = _frame0_with_offense(f)
        if 5 <= f < 9:
            b, s, sh = b + [box(150, 280)], s + [(-12.0, 0.0)], sh + [0.3]
        boxes.append(b), spots.append(s), shares.append(sh)
    assert not [t for t in follow_boxes(boxes, spots, shares) if t.seeded is not None]


def test_seeding_waits_until_it_knows_which_side_of_the_ball_the_scouted_team_is_on():
    """Both sides wearing the color about the same (or too few on either side): nobody is seeded late."""
    boxes, spots, shares = [], [], []
    for f in range(40):
        b, s, sh = _frame0_with_offense(f)
        sh = [0.4] * len(sh)  # everyone in the color: can't tell
        if f >= 5:
            b, s, sh = b + [box(150 + 2 * f, 280)], s + [(-12.0, 0.1 * f)], sh + [0.3]
        boxes.append(b), spots.append(s), shares.append(sh)
    assert not [t for t in follow_boxes(boxes, spots, shares) if t.seeded is not None]


def test_a_track_lost_for_a_few_frames_is_not_picked_up_by_a_box_yards_further_than_he_could_run():
    """The box overlaps where he was heading (a tall near-side box, the window in box heights is wide), but on the field it is 15 yards
    from where he was last seen 6 frames ago: not him."""
    boxes, spots = [], []
    for f in range(20):
        if f < 10:
            boxes.append([box(300, 300, 150)]); spots.append([(20.0, float(f) * 0.2)])
        elif f < 16:
            boxes.append([]); spots.append([])
        else:
            boxes.append([box(320, 300, 150)]); spots.append([(5.0, 2.0)])  # a box nearby in the picture, 15 yd away on the field
    track = follow_boxes(boxes, spots)[0]
    assert max(f for f, _ in track.matched) == 9

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
            spots.append([(float(f), 0.0), (float(f) + 3, 0.0)])
        else:
            boxes.append([box(300 + 3 * f, 300)])
            spots.append([(float(f), 0.0)])
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
    """White: the offense reads 0.20-0.42 white, the navy defense up to 0.13 (numbers, towels). With red's gate (0.04 / 0.01) a white
    receiver's track would take a defender reading 0.08; with white's own gate it refuses him."""
    from eval.scoutteam import wear_gate

    boxes, spots, shares = [], [], []
    for f in range(30):
        boxes.append([box(300 + 2 * f, 300)])
        shares.append([0.3 if f < 10 else 0.08])  # the receiver, then only the defender where he was going
        spots.append([(float(f), 0.0)])
    assert max(f for f, _ in follow_boxes(boxes, spots, shares)[0].matched) == 29  # red's gate: taken
    assert max(f for f, _ in follow_boxes(boxes, spots, shares, gate=wear_gate("white"))[0].matched) == 9
    assert wear_gate("Red") == wear_gate("gold") == (boxtrack.WEARS, boxtrack.NOT_WEARS)

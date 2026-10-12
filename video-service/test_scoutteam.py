"""Which side of the ball the scouted team (by jersey color) is on: drawn frames, no film."""

import numpy as np

from eval.scoutteam import color_share, scout_side

RED = (30, 30, 200)  # BGR
GOLD = (60, 170, 200)
WHITE = (240, 240, 240)


def frame_with(men):
    """`men`: (box, color). Each man is a block of his jersey color."""
    img = np.full((300, 600, 3), (40, 110, 40), np.uint8)  # grass
    for (x0, y0, x1, y1), color in men:
        img[y0:y1, x0:x1] = color
    return img


def line(color, x0, y):
    return [((x0 + 40 * i, y, x0 + 40 * i + 24, y + 60), color) for i in range(5)]


def test_the_scouted_team_is_on_offense_where_the_group_behind_the_ball_wears_its_color():
    red_o = line(RED, 100, 100)
    gold_d = line(GOLD, 100, 200)
    img = frame_with(red_o + gold_d)
    assert scout_side(img, [b for b, _ in red_o], [b for b, _ in gold_d], "red") == "offense"
    assert scout_side(img, [b for b, _ in red_o], [b for b, _ in gold_d], "gold") == "defense"


def test_a_color_both_groups_wear_or_one_we_dont_know_is_not_called():
    a = line(RED, 100, 100)
    b = line(RED, 100, 200)
    img = frame_with(a + b)
    assert scout_side(img, [x for x, _ in a], [x for x, _ in b], "red") is None
    assert scout_side(img, [x for x, _ in a], [x for x, _ in b], "chartreuse") is None
    assert scout_side(img, [], [x for x, _ in b], "red") is None


def test_white_pants_and_a_helmet_do_not_make_a_gold_team_red():
    gold = [((100, 100, 124, 160), GOLD)]
    img = frame_with(gold)
    assert color_share(img, (100, 100, 124, 160), "red") < 0.05
    assert color_share(img, (100, 100, 124, 160), "gold") > 0.9

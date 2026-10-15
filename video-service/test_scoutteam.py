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


def test_a_dark_jersey_with_white_numbers_does_not_count_as_white():
    """On CM vs Andover a navy jersey read up to 0.39 white (numbers, pants, a teammate in the box), more than some white receivers.
    A white jersey has no near-black on it, so a torso that has some is not wearing white."""
    from eval.scoutteam import color_share, dark_share, worn_share

    navy = np.full((100, 40, 3), (45, 18, 10), np.uint8)  # BGR: navy as it reads at night, near-black
    navy[25:45, 12:28] = 245  # big white numbers on the chest
    white = np.full((100, 40, 3), 235, np.uint8)
    white[25:40, 15:25] = (40, 40, 160)  # red numbers
    assert dark_share(navy, (0, 0, 40, 100)) > 0.3
    assert color_share(navy, (0, 0, 40, 100), "white") == 0.0
    assert color_share(white, (0, 0, 40, 100), "white") > 0.5
    assert worn_share("red", 0.4, 0.5) == 0.4  # only light colors have the dark test

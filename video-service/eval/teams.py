"""Which players are the offense: pure helpers, no numpy or model needed."""

from __future__ import annotations

Color = tuple[float, float, float]


def _dist2(a: Color, b: Color) -> float:
    return sum((x - y) ** 2 for x, y in zip(a, b))


def two_means(colors: list[Color], iterations: int = 20) -> list[int]:
    """Splits jersey colors into two groups (0 / 1), deterministically."""
    if len(colors) < 2:
        return [0] * len(colors)
    mean = tuple(sum(c[i] for c in colors) / len(colors) for i in range(3))
    first = max(colors, key=lambda c: _dist2(c, mean))
    second = max(colors, key=lambda c: _dist2(c, first))
    centers = [first, second]
    labels = [0] * len(colors)
    for _ in range(iterations):
        labels = [0 if _dist2(c, centers[0]) <= _dist2(c, centers[1]) else 1 for c in colors]
        moved = False
        for k in (0, 1):
            members = [c for c, l in zip(colors, labels) if l == k]
            if not members:
                continue
            new = tuple(sum(m[i] for m in members) / len(members) for i in range(3))
            moved = moved or new != centers[k]
            centers[k] = new
        if not moved:
            break
    return labels


def pick_offense(labels: list[int], downfield: list[float]) -> int:
    """The group that lines up behind the other. `downfield` is each player's yards past
    the ball in the offense's direction, so the defense (in front) has the larger average."""
    means = []
    for k in (0, 1):
        ys = [y for l, y in zip(labels, downfield) if l == k]
        means.append(sum(ys) / len(ys) if ys else float("inf"))
    return 0 if means[0] <= means[1] else 1


# Further behind the ball than this (yards, the offense's own view) is surely the offense, and
# further past it than SURE_DEFENSE_Y surely the defense. Between the two is the line itself,
# where offensive and defensive linemen stand a yard apart and the field mapping is only good
# to about half a yard, so those few are settled by jersey color instead.
SURE_OFFENSE_Y = -1.0
SURE_DEFENSE_Y = 1.5
MIN_SURE = 3


def split_teams(colors: list[Color], downfield: list[float]) -> tuple[list[int], int]:
    """Labels (0 / 1) for each person and which label is the offense.

    The offense lines up behind the ball and the defense in front of it, which holds up when
    jersey color doesn't (white jerseys in shade read as dark as navy ones). People clearly on
    one side are labeled by where they stand; the few on the line take the team whose jerseys
    they look most like. If the sides can't be told (too few people clearly on each), it falls
    back to splitting by color alone, calling the group that lines up behind the other the offense.
    `downfield` is each person's yards past the ball in the offense's direction.
    """
    sure_off = [i for i, y in enumerate(downfield) if y <= SURE_OFFENSE_Y]
    sure_def = [i for i, y in enumerate(downfield) if y >= SURE_DEFENSE_Y]
    if len(sure_off) < MIN_SURE or len(sure_def) < MIN_SURE:
        labels = two_means(colors)
        return labels, (pick_offense(labels, downfield) if labels else 0)

    def median(idx: list[int]) -> Color:
        return tuple(sorted(colors[i][c] for i in idx)[len(idx) // 2] for c in range(3))  # type: ignore[return-value]

    centers = {0: median(sure_off), 1: median(sure_def)}
    labels = []
    for i, y in enumerate(downfield):
        if y <= SURE_OFFENSE_Y:
            labels.append(0)
        elif y >= SURE_DEFENSE_Y:
            labels.append(1)
        else:
            labels.append(0 if _dist2(colors[i], centers[0]) <= _dist2(colors[i], centers[1]) else 1)
    return labels, 0

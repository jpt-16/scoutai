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
# With no gap to split at, the offense is everyone at or behind this depth (yards past the ball).
NEUTRAL_Y = 0.3


# The line of scrimmage is the biggest empty stretch between the two lines of linemen, looked for
# only among men near the ball, and it has to be at least this wide (yards) to count.
LOS_SEARCH = (-3.0, 3.0)
MIN_LOS_GAP = 0.5


LINE_REACH = 2.0
# At least this many men within reach behind the boundary (the offense's line and receivers on it) and
# ahead of it (a defense may stand up, so only two of them need to be near the ball).
MIN_BEHIND, MIN_AHEAD = 3, 2


def line_boundary(downfield: list[float]) -> float | None:
    """Where the offense ends and the defense starts, in yards past the ball: the middle of the
    widest gap between neighbours among the men standing near the line, provided it has men within
    `LINE_REACH` yards on both sides of it (`MIN_BEHIND`, `MIN_AHEAD`). Otherwise None."""
    near = sorted(y for y in downfield if LOS_SEARCH[0] <= y <= LOS_SEARCH[1])
    best: tuple[float, float] | None = None
    for a, b in zip(near, near[1:]):
        width, middle = b - a, (a + b) / 2
        if width < MIN_LOS_GAP:
            continue
        behind = sum(1 for y in downfield if middle - LINE_REACH <= y <= middle)
        ahead = sum(1 for y in downfield if middle <= y <= middle + LINE_REACH)
        if behind >= MIN_BEHIND and ahead >= MIN_AHEAD and (best is None or width > best[0]):
            best = (width, middle)
    return best[1] if best else None


def split_teams(colors: list[Color], downfield: list[float]) -> tuple[list[int], int]:
    """Labels (0 / 1) for each person and which label is the offense.

    The offense lines up behind the ball and the defense in front of it, which holds up when
    jersey color doesn't (white jerseys in shade read as dark as navy ones). The line of scrimmage
    is found as the widest gap between the two lines of linemen (`line_boundary`) and everyone is
    labeled by which side of it he stands. With no clear gap, people clearly on one side are labeled by
    where they stand and the few on the line take the team whose jerseys they look most like. If the sides
    can't be told at all, it falls back to splitting by color alone, calling the group behind the other the offense.
    `downfield` is each person's yards past the ball in the offense's direction.
    """
    boundary = line_boundary(downfield)
    if boundary is not None and sum(y < boundary for y in downfield) >= MIN_SURE and sum(y > boundary for y in downfield) >= MIN_SURE:
        return [0 if y < boundary else 1 for y in downfield], 0
    sure_off = [i for i, y in enumerate(downfield) if y <= SURE_OFFENSE_Y]
    sure_def = [i for i, y in enumerate(downfield) if y >= SURE_DEFENSE_Y]
    if len(sure_off) < MIN_SURE or len(sure_def) < MIN_SURE:
        labels = two_means(colors)
        return labels, (pick_offense(labels, downfield) if labels else 0)
    # No clear line of scrimmage to split at (a defense that stands up, a pile of linemen the detector saw
    # only part of): split at the ball's own depth. Jersey color is no help here, a navy man at the line
    # reads as "white" in shade, so it is not used.
    return [0 if y <= NEUTRAL_Y else 1 for y in downfield], 0

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

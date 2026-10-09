"""Names a formation from where the offense lined up, in yards.

Pure and dependency-free, so it runs (and is tested) without a GPU, a model or a
video. Everything is relative to the ball: x is yards to the offense's right (left is
negative), y is yards downfield of the line (behind the line is negative).

This is the rule-based half of "read the formation off one pre-snap frame". The
players' positions come from `presnap.py` (a detector plus a field mapping); the rules
here are deliberately plain, so a wrong answer can be traced to a position or a rule,
and the thresholds are the knobs to tune against real film.
"""

from __future__ import annotations

from dataclasses import dataclass

# Players this close to the line are "on the line" (a quarterback under center, about a
# yard back, is not).
ON_LINE_MIN_Y = -0.8
ON_LINE_MAX_Y = 1.5
# A player on or off the line within this many yards of the box's edge is attached
# (a tight end or wing), not split out.
ATTACHED_YARDS = 3.0
# A quarterback this close to the line is under center, else shotgun / pistol.
UNDER_CENTER_MIN_Y = -2.0
# Two backs lined up within this many yards of each other sideways are stacked.
STACKED_X = 1.5
# The offensive line is the five players on the line closest to the ball.
LINEMEN = 5
MIN_PLAYERS = 7


@dataclass(frozen=True)
class Spot:
    x: float
    y: float


@dataclass(frozen=True)
class Formation:
    key: str  # one of vocab.FORMATION_KEYS
    strength: str | None  # "left" | "right" | None when balanced or unknown
    notes: str = ""


def classify(offense: list[Spot]) -> Formation:
    if len(offense) < MIN_PLAYERS:
        return Formation("unknown", None, f"only {len(offense)} offensive players found")

    on_line = [p for p in offense if ON_LINE_MIN_Y <= p.y <= ON_LINE_MAX_Y]
    line = sorted(on_line, key=lambda p: abs(p.x))[:LINEMEN]
    if len(line) < 3:
        return Formation("unknown", None, "no offensive line found on the ball")
    edge_left = min(p.x for p in line)
    edge_right = max(p.x for p in line)
    rest = [p for p in offense if p not in line]

    # Backfield: behind the line and inside the box's width (plus a yard).
    backfield = [p for p in rest if p.y < ON_LINE_MIN_Y and edge_left - 1 <= p.x <= edge_right + 1]
    qb = min(backfield, key=lambda p: (abs(p.x), -p.y)) if backfield else None
    backs = [p for p in backfield if p is not qb]
    out = [p for p in rest if p not in backfield]

    def beyond_box(p: Spot) -> float:
        return p.x - edge_right if p.x > 0 else edge_left - p.x

    attached = [p for p in out if beyond_box(p) <= ATTACHED_YARDS]
    wide = [p for p in out if beyond_box(p) > ATTACHED_YARDS]
    te_left = sum(1 for p in attached if p.x < 0)
    te_right = sum(1 for p in attached if p.x > 0)
    wide_left = sum(1 for p in wide if p.x < 0)
    wide_right = sum(1 for p in wide if p.x > 0)

    left = te_left + wide_left
    right = te_right + wide_right
    strength = "right" if right > left else "left" if left > right else None
    detail = f"wide {wide_left}-{wide_right}, attached {te_left}-{te_right}, backs {len(backs)}"

    if max(wide_left, wide_right) >= 3:
        return Formation("trips", "left" if wide_left > wide_right else "right", detail)
    if te_left >= 1 and te_right >= 1:
        return Formation("double-eagle", strength, detail)
    under_center = qb is not None and qb.y >= UNDER_CENTER_MIN_Y
    if not under_center:
        return Formation("spread", strength, detail + ", shotgun")
    if len(backs) >= 2:
        # The app's Pro is I-backs (one behind the other); "i-form" is only ever a name a
        # staff writes, which the scorer treats as the same family.
        side_by_side = abs(backs[0].x - backs[1].x) > STACKED_X
        return Formation("split-pro" if side_by_side else "pro", strength, detail)
    return Formation("pro", strength, detail)

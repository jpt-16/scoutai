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
# Finding the line: the offensive line is a given, so it is found as the row of men nearest the
# ball's middle, wherever that row happens to sit (the ball spot can be a yard off): men within
# LINE_HALF_WIDTH yards sideways and between these depths, in a row at most ROW_TOLERANCE deep.
LINE_HALF_WIDTH = 7.0
LINE_DEPTHS = (-2.5, 1.5)
ROW_TOLERANCE = 0.7
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
    # The staff's own name for it ("deuces gun", "trio gun left"): see `staff_name`.
    staff: str = ""


def classify(offense: list[Spot]) -> Formation:
    """The formation, with a note when the count isn't the 11 an offense has, since a read from
    9 or 14 men is worth a second look (a man the detector missed, or a referee counted)."""
    got = _classify(offense)
    if len(offense) != 11 and got.key != "unknown":
        note = f"{len(offense)} offensive players found, expected 11"
        return Formation(got.key, got.strength, f"{got.notes}; {note}" if got.notes else note, got.staff)
    return got


def find_line(offense: list[Spot]) -> list[Spot]:
    """The offensive linemen: the biggest row of men (up to five, the ones nearest the middle) that
    stand side by side within a yard of the ball's spot. Returns [] if there isn't a row of three."""
    near = [p for p in offense if abs(p.x) <= LINE_HALF_WIDTH and LINE_DEPTHS[0] <= p.y <= LINE_DEPTHS[1]]
    best: tuple[int, float, list[Spot]] | None = None
    for y0 in {p.y for p in near}:
        row = [p for p in near if abs(p.y - y0) <= ROW_TOLERANCE]
        key = (min(len(row), LINEMEN), -abs(y0))
        if best is None or key > (best[0], best[1]):
            best = (key[0], key[1], row)
    if best is None or len(best[2]) < 3:
        return []
    return sorted(best[2], key=lambda p: abs(p.x))[:LINEMEN]


def _classify(offense: list[Spot]) -> Formation:
    if len(offense) < MIN_PLAYERS:
        return Formation("unknown", None, f"only {len(offense)} offensive players found")

    line = find_line(offense)
    if len(line) < 3:
        return Formation("unknown", None, "no offensive line found on the ball")
    # Measure everything from the line, not from the ball spot, which can be a yard off: the line's
    # own depth is where "on the line" and "in the backfield" are counted from.
    depth = sorted(p.y for p in line)[len(line) // 2]
    shifted = {id(p): Spot(p.x, p.y - depth) for p in offense}
    line = [shifted[id(p)] for p in line]
    offense = [shifted[id(p)] for p in offense]
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

    under_center = qb is not None and qb.y >= UNDER_CENTER_MIN_Y
    skill = attached + wide
    staff = staff_name(
        wide=wide, attached=attached, backs=backs, under_center=under_center, strength=strength
    )

    def make(key: str, side: str | None, extra: str = "") -> Formation:
        return Formation(key, side, detail + extra, staff)

    if max(wide_left, wide_right) >= 3:
        return make("trips", "left" if wide_left > wide_right else "right")
    if te_left >= 1 and te_right >= 1:
        return make("double-eagle", strength)
    if not under_center:
        return make("spread", strength, ", shotgun")
    if len(backs) >= 2:
        # The app's Pro is I-backs (one behind the other); "i-form" is only ever a name a
        # staff writes, which the scorer treats as the same family.
        side_by_side = abs(backs[0].x - backs[1].x) > STACKED_X
        return make("split-pro" if side_by_side else "pro", strength)
    return make("pro", strength)


# The staff's formation names (the staff's own words, kept in step with the app's vocabulary in
# `classifyFormation`). Receivers are everyone off the line who isn't a back: tight ends (attached
# within ATTACHED_YARDS of the box) and wide receivers, counted by side.
BUNCH_YARDS = 3.0


def staff_name(
    *, wide: list[Spot], attached: list[Spot], backs: list[Spot], under_center: bool, strength: str | None
) -> str:
    """Names the shape in the staff's own words. "gun" (shotgun) is said when the QB is in it; under
    center is the default and is not written. The strength side is added where it matters. "" when the
    shape is none of the staff's names.

    DUCES 2x2, one back. TRIO (also called SLOT TRIPS, the same formation) three receivers to one side,
    one to the other, one back. EMPTY five receivers and no back. ACES three wide receivers, a tight end
    and one back (ACES OFF with the tight end off the line). PRO under center, two backs, a tight end
    and a receiver each side; TWINS the same people with both receivers on one side and the tight end the
    other way. BUNCH three receivers within three yards of each other, one on the line and two off it."""
    gun = "" if under_center else " gun"
    side = {"left": " left", "right": " right"}.get(strength or "", "")
    skill = wide + attached
    wide_left = sum(1 for p in wide if p.x < 0)
    wide_right = len(wide) - wide_left

    # BUNCH: three receivers in a cluster, one on the line, the other two off it.
    for a in skill:
        near = [p for p in skill if (p.x - a.x) ** 2 + (p.y - a.y) ** 2 <= BUNCH_YARDS**2]
        if len(near) >= 3 and sum(1 for p in near if p.y >= ON_LINE_MIN_Y) == 1:
            return f"bunch{gun}{side}"

    if under_center:
        if len(backs) >= 2 and len(attached) == 1 and len(wide) == 2:
            return f"pro{side}" if (wide_left == 1 and wide_right == 1) else f"twins{side}"
        return ""
    if not backs and len(skill) >= 5:
        return "empty gun"
    if len(backs) == 1 and not attached and len(wide) == 4:
        if wide_left == wide_right == 2:
            return "deuces gun"
        if max(wide_left, wide_right) == 3:
            return f"trio gun{side}"
    if len(backs) == 1 and len(attached) == 1 and len(wide) == 3:
        return f"{'aces off' if attached[0].y < ON_LINE_MIN_Y else 'aces'} gun{side}"
    return ""

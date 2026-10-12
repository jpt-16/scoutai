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
# LINE_REACH_X yards sideways of each other and between these depths, in a row at most ROW_TOLERANCE deep.
LINE_REACH_X = 4.5
LINE_DEPTHS = (-2.5, 1.5)
ROW_TOLERANCE = 0.7
MIN_PLAYERS = 7
# Linemen locked together with the defense are one blob to a detector at press-box distance, so a row of three is
# often not found. When it isn't and the skill men are (at least ASSUMED_SKILL of them: a QB, a back and four receivers; fewer is a guess), the line is taken to be a
# standard one on the ball: five men ASSUMED_SPLIT apart, at the depth of whoever was found in the box. The first
# real film read 7 of 11 men and no line, and so no formation at all.
ASSUMED_SKILL = 6
ASSUMED_SPLIT = 1.2
ASSUMED_BOX_X = 3.0


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
    """The offensive linemen: the biggest cluster of men (up to five) standing side by side in a row, found
    anywhere across the formation, so the ball can be marked a few yards off the middle without losing the
    line. A cluster is men within LINE_REACH_X yards sideways of an anchor man and within a row's depth of
    him. The row is looked for at a tight depth first, and if that finds fewer than three (the field
    mapping spreads a line's depth by a yard or so), again at a looser one. The cluster nearest the ball
    wins a tie. Returns [] if there isn't a row of three."""
    near = [p for p in offense if LINE_DEPTHS[0] <= p.y <= LINE_DEPTHS[1]]
    for tolerance in (ROW_TOLERANCE, 2 * ROW_TOLERANCE):
        best: tuple[int, float, list[Spot]] | None = None
        for anchor in near:
            row = [p for p in near if abs(p.y - anchor.y) <= tolerance and abs(p.x - anchor.x) <= LINE_REACH_X]
            key = (min(len(row), LINEMEN), -(abs(anchor.x) + abs(anchor.y)))
            if best is None or key > (best[0], best[1]):
                best = (key[0], key[1], row)
        if best is not None and len(best[2]) >= 3:
            middle = sorted(p.x for p in best[2])[len(best[2]) // 2]
            return sorted(best[2], key=lambda p: abs(p.x - middle))[:LINEMEN]
    return []


def _classify(offense: list[Spot]) -> Formation:
    if len(offense) < MIN_PLAYERS:
        return Formation("unknown", None, f"only {len(offense)} offensive players found")

    line = find_line(offense)
    assumed = False
    if len(line) < 3:
        box = [p for p in offense if abs(p.x) <= ASSUMED_BOX_X and LINE_DEPTHS[0] <= p.y <= LINE_DEPTHS[1]]
        if len(offense) - len(box) < ASSUMED_SKILL:
            return Formation("unknown", None, "no offensive line found on the ball")
        depth = sorted(p.y for p in box)[len(box) // 2] if box else 0.0
        line = [Spot(ASSUMED_SPLIT * k, depth) for k in (-2, -1, 0, 1, 2)]
        offense = [p for p in offense if p not in box] + line
        assumed = True
    # Measure everything from the line, not from the ball spot, which can be a yard off: the line's
    # own depth is where "on the line" and "in the backfield" are counted from.
    depth = sorted(p.y for p in line)[len(line) // 2]
    # The same for the middle: the ball spot can be a few yards off sideways, and which side a receiver
    # is on is counted from the middle of the line, not from where the ball was marked.
    middle = sorted(p.x for p in line)[len(line) // 2]
    shifted = {id(p): Spot(p.x - middle, p.y - depth) for p in offense}
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
    if assumed:
        detail += "; the line wasn't seen (hidden in the pile), assumed on the ball"

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
        return f"empty gun{side}"
    if len(backs) == 1 and not attached and len(wide) == 4:
        if wide_left == wide_right == 2:
            return "deuces gun"
        if max(wide_left, wide_right) == 3:
            return f"trio gun{side}"
    if len(backs) == 1 and len(attached) == 1 and len(wide) == 3:
        return f"{'aces off' if attached[0].y < ON_LINE_MIN_Y else 'aces'} gun{side}"
    return ""

"""Which side of the ball the team being scouted is on, from its jersey color.

The scout cards are for one team (the opponent, "the red team"): its offense gives the Scout O cards and its defense the Scout D
cards. A play's film shows both teams, so each clip says which side of the ball the scouted team played: where the group
behind the ball wears its color it is on offense, where the group past the ball does it is on defense. A Scout D card from a clip
where the scouted team has the ball would be the *other* team's defense.
"""

from __future__ import annotations

import cv2
import numpy as np

# Hue (OpenCV: 0-179) / saturation / value ranges of the colors a team wears. Red wraps around 0.
COLORS: dict[str, list[tuple[tuple[int, int, int], tuple[int, int, int]]]] = {
    "red": [((0, 100, 70), (8, 255, 255)), ((170, 100, 70), (179, 255, 255))],
    "orange": [((9, 120, 100), (17, 255, 255))],
    "gold": [((18, 70, 110), (34, 255, 255))],
    "yellow": [((18, 70, 110), (34, 255, 255))],
    "green": [((40, 60, 40), (85, 255, 255))],
    "blue": [((95, 80, 40), (130, 255, 255))],
    "navy": [((95, 80, 20), (130, 255, 140))],
    "purple": [((131, 60, 40), (160, 255, 255))],
    "white": [((0, 0, 170), (179, 45, 255))],
    "black": [((0, 0, 0), (179, 255, 55))],
}

# The scouted team has to out-wear the other by this share of the torso to be called.
MIN_GAP = 0.06

# How much of a torso in the scouted team's color says a man wears it, and under how much he doesn't, by color: (wears, doesn't).
# Red was measured with a gold defense that wears none of it (offense 0.07-0.68, defense 0.00), so the tracker's gate can be fine.
# White is not like that: on the CM vs Andover film the white offense reads 0.20-0.42, while Andover's navy jerseys read 0.00-0.13 (white
# numbers, towels, sleeves; a few to 0.30) and referees 0.03-0.17. A color not listed here uses `DEFAULT_GATE` / `DEFAULT_SIDE`.
GATES = {"white": (0.18, 0.10)}
DEFAULT_GATE = (0.04, 0.01)  # the box tracker's gate (`boxtrack.follow_boxes`)
SIDES = {"white": (0.18, 0.10)}
DEFAULT_SIDE = (0.15, 0.06)  # correcting a man's side at the snap (`tracks.team_by_jersey`)


def wear_gate(color: str) -> tuple[float, float]:
    """(wears, doesn't) for the box tracker's jersey gate."""
    return GATES.get(color.strip().lower(), DEFAULT_GATE)


def side_shares(color: str) -> tuple[float, float]:
    """(sure, not) for telling a man's side at the snap by the scouted team's color."""
    return SIDES.get(color.strip().lower(), DEFAULT_SIDE)


def color_share(frame_bgr: np.ndarray, box, color: str) -> float:
    """The share of a man's torso (the jersey, not helmet or legs) that is `color`."""
    x0, y0, x1, y1 = (int(v) for v in box[:4])
    h, w = y1 - y0, x1 - x0
    torso = frame_bgr[max(0, y0 + int(0.18 * h)) : max(0, y0 + int(0.5 * h)), max(0, x0 + int(0.22 * w)) : max(0, x0 + int(0.78 * w))]
    if torso.size == 0:
        return 0.0
    hsv = cv2.cvtColor(torso, cv2.COLOR_BGR2HSV)
    mask = np.zeros(hsv.shape[:2], np.uint8)
    for lo, hi in COLORS[color]:
        mask |= cv2.inRange(hsv, np.array(lo, np.uint8), np.array(hi, np.uint8))
    return float((mask > 0).mean())


def scout_side(frame_bgr: np.ndarray, offense, defense, color: str) -> str | None:
    """"offense" or "defense": the side of the ball the team wearing `color` is on, or None when it can't be told
    (no color given, not a color we know, either group missing, or the two groups wear it about equally)."""
    color = color.strip().lower()
    if color not in COLORS or not offense or not defense:
        return None
    mine = float(np.median([color_share(frame_bgr, b, color) for b in offense]))
    theirs = float(np.median([color_share(frame_bgr, b, color) for b in defense]))
    if abs(mine - theirs) < MIN_GAP:
        return None
    return "offense" if mine > theirs else "defense"

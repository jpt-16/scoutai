"""The app's formation vocabulary in Python, so a Hudl row, a coach's correction and
our own reading of a clip can all be compared as the same six shapes.

This is a port of `classifyFormation` / `parseSideTag` in src/lib/hudlParser.ts. The
patterns are kept as the same strings, and test_eval.py checks every one of them
still appears in that file, so the two can't quietly drift apart.
"""

from __future__ import annotations

import re

# (pattern, key) in the order the TypeScript checks them; first match wins.
FORMATION_PATTERNS: list[tuple[str, str]] = [
    (r"\s(DOUBLE|DBL|DBLE)\s*EAGLE\s|\sEAGLE\s", "double-eagle"),
    (r"\s(TRIPS|TREY|TRIO|TRIPLE|BUNCH)\s", "trips"),
    (r"\s(I|IFORM|I FORM|POWER I|TIGHT I|SLOT I|MAX I)\s", "i-form"),
    (r"\s(SPLIT|SPLITS|SPLIT BACK|SPLIT BACKS|SPLITBACK|SPLITBACKS|SPLIT PRO|PRO SPLIT)\s", "split-pro"),
    (r"\s(PRO|WEAK|STRONG|TWINS)\s", "pro"),
    (r"\s(SPREAD|DOUBLES|DBLS|2X2|GUN|SHOTGUN|ACE|ACES|DEUCE|DEUCES|DUCES|EMPTY|DOUBLE)\s", "spread"),
]

FORMATION_KEYS = ["spread", "trips", "i-form", "double-eagle", "pro", "split-pro", "unknown"]


def _words(text: str) -> str:
    return " " + re.sub(r"\s+", " ", re.sub(r"[-/_.,]", " ", text.upper())).strip() + " "


def classify_formation(text: str) -> str:
    """A formation name ("Trips Rt", "Duces Gun") as one of the app's keys."""
    if not text.strip():
        return "unknown"
    padded = _words(text)
    for pattern, key in FORMATION_PATTERNS:
        if re.search(pattern, padded):
            return key
    return "unknown"


def parse_side(text: str) -> str | None:
    """The strength side a formation name carries ("Trips Rt" -> "right"), else None."""
    padded = _words(text)
    if re.search(r"\s(LT|LEFT|LFT|LIZ|LOU|L)\s", padded):
        return "left"
    if re.search(r"\s(RT|RIGHT|RGT|RIP|RAY|R)\s", padded):
        return "right"
    return None

"""A coach's taps: "this man is X", "this man is Y", on one frame of a play.

    {"frame": 112, "taps": {"X": [412, 530], "F": [655, 541], "Y": [701, 538], "Z": [1210, 540], "H": [820, 610], "Q": [790, 575]}}

`frame` is the clip's own video frame (the one the coach paused on, about the snap) and each tap a pixel of that frame, anywhere
on the man; a tap may carry its own frame as a third number (`"H": [820, 610, 118]`) when he was tapped on another one
(`public/tap.html` writes that, so a coach can step the video between taps). A tap is turned into a person the detector found there (`resolve`): the box the tap is in, or the one it is nearest, in
the frame it was made on or a few either side (a man the detector misses on exactly that frame is found a frame or two later). The
tracker then starts that man's track there if nobody follows him yet, or names the track that already does (`boxtrack.follow_boxes`'s
`forced`), and the card gets his letter from the tap instead of from where he stands (`trackedPlay.ts`). A tap with no one near it is
reported, never guessed.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

# How far from a box's middle a tap may land and still be that man, in box heights (a tap on his helmet or his knees is within 0.5).
NEAR_HEIGHTS = 0.6
# How many frames either side of the tap's frame to look for a man the detector missed on it (the camera is held, so the tap carries over).
SEARCH_FRAMES = 6
LETTERS = ("X", "F", "Y", "Z", "H", "Q")


@dataclass(frozen=True)
class Tap:
    letter: str
    frame: int  # on the tracker's timeline (frame 0 is the calibrated frame)
    x: float  # pixels of that frame
    y: float


def read_taps(data: dict, start: int = 0) -> list[Tap]:
    """The taps of a taps file (`start`: the clip frame the tracker's frame 0 is, the calibration's `frame`). Unknown letters are
    dropped, and a letter tapped twice keeps the last."""
    default = int(data["frame"]) if data.get("frame") is not None else 0
    out: dict[str, Tap] = {}
    for letter, point in (data.get("taps") or {}).items():
        letter = str(letter).strip().upper()
        if letter in LETTERS and isinstance(point, (list, tuple)) and len(point) in (2, 3):
            frame = int(point[2]) if len(point) == 3 else default
            out[letter] = Tap(letter, max(0, frame - int(start)), float(point[0]), float(point[1]))
    return list(out.values())


def load_taps(path: Path, start: int = 0) -> list[Tap]:
    return read_taps(json.loads(Path(path).read_text()), start)


def _offsets():
    yield 0
    for k in range(1, SEARCH_FRAMES + 1):
        yield k
        yield -k


def resolve(taps: list[Tap], warped: list[list[tuple[float, float, float, float]]], to_snap) -> tuple[list[tuple[int, int, str]], list[str]]:
    """(forced, notes): `forced` is `(frame, person, letter)` for every tap that found a man (`warped[f][j]` his box on the snap
    frame, `boxtrack.warp_boxes`), `notes` says who was not found. Two taps that land on one box (two receivers the detector
    sees as one man, a stack) both resolve to it: the tracker follows him as the first and the second is reported as sharing him."""
    forced: list[tuple[int, int, str]] = []
    notes: list[str] = []
    for tap in taps:
        k = min(tap.frame, len(warped) - 1)
        p = cv2.perspectiveTransform(np.float32([[[tap.x, tap.y]]]), np.asarray(to_snap[k], dtype=np.float64))[0, 0]
        found = None
        for dk in _offsets():
            f = k + dk
            if not 0 <= f < len(warped):
                continue
            best = None
            for j, b in enumerate(warped[f]):
                h = max(b[3] - b[1], 1.0)
                d = math.hypot(p[0] - (b[0] + b[2]) / 2, p[1] - (b[1] + b[3]) / 2) / h
                if (b[0] <= p[0] <= b[2] and b[1] <= p[1] <= b[3]) or d <= NEAR_HEIGHTS:
                    if best is None or d < best[0]:
                        best = (d, j)
            if best is not None:
                found = (f, best[1])
                break
        if found is None:
            notes.append(f"{tap.letter}: nobody found near the tap")
        else:
            forced.append((found[0], found[1], tap.letter))
    return forced, notes

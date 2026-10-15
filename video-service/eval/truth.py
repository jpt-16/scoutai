"""How often a tracks file has each man on his own track, against positions marked by hand.

    python -m eval.truth tracks/play_05.json eval/truth/play_05.json

Route names say whether the whole chain worked; this says whether the tracker did. A truth file marks where each
receiver really was at a few frames (yards from the ball, offense's view; see `truth/play_05.json`). His track is
the one nearest his first mark at that frame; a later mark counts as right when that track is within `HIT_YARDS` of it
(within two frames), wrong when the track is somewhere else, and missing when the track has ended or skipped it.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

HIT_YARDS = 1.5
NEAR_FRAMES = 2


def score(tracks: dict, truth: dict) -> tuple[int, int, list[str]]:
    fps = tracks["fps"]
    offense = [t for t in tracks["tracks"] if t["team"] == "offense" and t["points"]]
    right = total = 0
    lines = []
    for name, marks in truth["men"].items():
        frames = sorted((int(k), v) for k, v in marks.items())
        (_, (x0, y0)), later = frames[0], frames[1:]
        f0 = frames[0][0]

        def gap_at_first(t) -> float:
            # Where the track was at his first mark (a track may start after frame 0: `boxtrack.SEED_FRAMES`); a track not there
            # then is scored by where it started, behind every track that was.
            near = [np.hypot(x - x0, y - y0) for s, x, y in t["points"] if abs(round(s * fps) - f0) <= NEAR_FRAMES]
            return min(near) if near else 1000 + float(np.hypot(t["points"][0][1] - x0, t["points"][0][2] - y0))

        own = min(offense, key=gap_at_first)
        row = []
        for f, (gx, gy) in later:
            total += 1
            near = [(abs(round(s * fps) - f), x, y) for s, x, y in own["points"] if abs(round(s * fps) - f) <= NEAR_FRAMES]
            if not near:
                row.append(f"{f}:missing")
                continue
            _, x, y = min(near)
            hit = np.hypot(x - gx, y - gy) <= HIT_YARDS
            right += hit
            row.append(f"{f}:{'right' if hit else 'wrong'}")
        lines.append(f"{name}: " + " ".join(row))
    return right, total, lines


def main() -> None:
    tracks = json.loads(Path(sys.argv[1]).read_text())
    truth = json.loads(Path(sys.argv[2]).read_text())
    right, total, lines = score(tracks, truth)
    print(f"{right} of {total} marks on the man's own track")
    for line in lines:
        print("  " + line)


if __name__ == "__main__":
    main()

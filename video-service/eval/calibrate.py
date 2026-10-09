"""Pick the pre-snap frame of a clip and mark where the field is: once per clip.

    python -m eval.calibrate clips/play_01.mp4

A window shows the clip. Step to the frame just before the snap (a / d: one frame,
w / s: ten), press Enter, then click four spots where a yard line meets a hash mark or
a sideline. After each click, type where it is in the terminal, e.g. `35 HL`: the yard
line's number on the field and which of SL (left sideline), HL (left hash), HR (right
hash) or SR (right sideline) it is on, left and right as you'd see them looking toward
the higher yard numbers. Then click the ball and say which way the offense is going
(`up` toward higher numbers, `down` toward lower).

Writes clips/play_01.json beside the clip. The detector and the formation rules take
it from there (`python -m eval.presnap`). High school fields: hashes 17.78 yards in
from each sideline, 53.33 yards wide (NFHS).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2

FIELD_WIDTH = 160 / 3  # yards
HASH_X = {"SL": 0.0, "HL": 17.78, "HR": FIELD_WIDTH - 17.78, "SR": FIELD_WIDTH}


def parse_spot(text: str) -> tuple[float, float]:
    """"35 HL" -> (x across, y along) in yards."""
    parts = text.upper().split()
    if len(parts) != 2 or parts[1] not in HASH_X or not parts[0].isdigit():
        raise ValueError("type a yard line and SL, HL, HR or SR, like `35 HL`")
    return HASH_X[parts[1]], float(parts[0])


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    path = Path(sys.argv[1])
    cap = cv2.VideoCapture(str(path))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        raise SystemExit(f"can't read {path}")

    def frame_at(i: int):
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, frame = cap.read()
        return frame if ok else None

    index = 0
    title = "frame: a/d = 1, w/s = 10, Enter = this one"
    while True:
        frame = frame_at(index)
        shown = frame.copy()
        cv2.putText(shown, f"{index}/{total - 1}", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
        cv2.imshow(title, shown)
        key = cv2.waitKey(0) & 0xFF
        if key in (13, 10):
            break
        index = max(0, min(total - 1, index + {ord("d"): 1, ord("a"): -1, ord("w"): 10, ord("s"): -10}.get(key, 0)))
    cv2.destroyAllWindows()

    clicks: list[tuple[int, int]] = []

    def on_click(event, x, y, *_):
        if event == cv2.EVENT_LBUTTONDOWN:
            clicks.append((x, y))

    def click_one(prompt: str) -> tuple[int, int]:
        n = len(clicks)
        cv2.setMouseCallback("click", on_click)
        print(prompt)
        while len(clicks) == n:
            cv2.imshow("click", frame)
            cv2.waitKey(50)
        cv2.circle(frame, clicks[-1], 6, (0, 0, 255), -1)
        return clicks[-1]

    cv2.namedWindow("click")
    source, destination = [], []
    for i in range(4):
        pt = click_one(f"Click spot {i + 1} of 4 (a yard line meeting a hash or sideline)")
        while True:
            try:
                dest = parse_spot(input("  where is it? (e.g. 35 HL): "))
                break
            except ValueError as e:
                print("  ", e)
        source.append(pt)
        destination.append(dest)
    ball = click_one("Click the ball")
    direction = ""
    while direction not in ("UP", "DOWN"):
        direction = input("Which way is the offense going, up or down the yard numbers? ").strip().upper()
    cv2.destroyAllWindows()

    out = path.with_suffix(".json")
    out.write_text(
        json.dumps(
            {
                "frame": index,
                "source": [list(p) for p in source],
                "destination": [list(p) for p in destination],
                "ball": list(ball),
                "direction": 1 if direction == "UP" else -1,
            },
            indent=2,
        )
    )
    print(f"saved {out}")


if __name__ == "__main__":
    main()

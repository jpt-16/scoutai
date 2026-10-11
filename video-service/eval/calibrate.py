"""Pick the pre-snap frame of a clip and mark where the field is: once per clip.

    python -m eval.calibrate clips/play_01.mp4 [--frame 190 --use-frame]

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

import argparse
import json
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
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("clip", type=Path)
    ap.add_argument("--frame", type=int, default=0, help="frame to start on (and, with --use-frame, to use as is)")
    ap.add_argument("--use-frame", action="store_true", help="skip the frame picker and calibrate on --frame")
    args = ap.parse_args()
    path = args.clip
    cap = cv2.VideoCapture(str(path))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        raise SystemExit(f"can't read {path}")

    def frame_at(i: int):
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, frame = cap.read()
        return frame if ok else None

    index = max(0, min(total - 1, args.frame))
    title = "frame: a/d = 1, w/s = 10, Enter = this one"
    while not args.use_frame:
        frame = frame_at(index)
        shown = frame.copy()
        cv2.putText(shown, f"{index}/{total - 1}", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
        cv2.imshow(title, shown)
        key = cv2.waitKey(0) & 0xFF
        if key in (13, 10):
            break
        index = max(0, min(total - 1, index + {ord("d"): 1, ord("a"): -1, ord("w"): 10, ord("s"): -10}.get(key, 0)))
    cv2.destroyAllWindows()
    frame = frame_at(index)

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
    cv2.imshow("click", frame)
    cv2.waitKey(50)
    # Clicking a window to bring it forward would count as a click on the field, so do that now.
    input("The picture window is open. Click on it once to bring it forward, then come back here and press Enter. ")
    source, destination = [], []
    for i in range(4):
        while True:
            pt = click_one(f"Click spot {i + 1} of 4 (a yard line meeting a hash or sideline)")
            answer = input("  where is it? (e.g. 35 HL, or `skip` if that click was a mistake): ")
            if answer.strip().lower() in ("skip", "redo", "s"):
                clicks.pop()
                print("  ok, click again")
                continue
            try:
                dest = parse_spot(answer)
            except ValueError as e:
                print("  ", e)
                clicks.pop()
                print("  click that spot again")
                continue
            break
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

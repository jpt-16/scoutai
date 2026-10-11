"""Turns screen recordings of Hudl's player into clips the pipeline can read.

    python -m eval.prep recordings/ --out clips/ --top 84 --bottom 56

A screen recording of Hudl has the player's own chrome around the film: the tag bar across the top
(PLAY #, OFF FORM, OFF PLAY, ...), the controls along the bottom, a black margin. Those are bright
text and lines that the field finder would take for paint, so they are cut off here, and the
clips are written as `play_01.mp4`, `play_02.mp4`, ... in the order of the recordings' names
(or, with `--by-tag`, nothing is guessed: the order of the file names is the order of the plays).

For the 1470 x 956 recordings Hudl's web player makes on a Mac, `--top 84 --bottom 56` leaves just
the film. Check one frame (`--preview`) before cutting a whole folder.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2

VIDEOS = {".mp4", ".mov", ".m4v"}


def crop_clip(src: Path, dst: Path, top: int, bottom: int, left: int = 0, right: int = 0) -> int:
    cap = cv2.VideoCapture(str(src))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    box = (left, top, w - right, h - bottom)
    out = cv2.VideoWriter(str(dst), cv2.VideoWriter_fourcc(*"mp4v"), fps, (box[2] - box[0], box[3] - box[1]))
    n = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        out.write(frame[box[1] : box[3], box[0] : box[2]])
        n += 1
    out.release()
    return n


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("recordings", type=Path)
    ap.add_argument("--out", type=Path, default=Path("clips"))
    ap.add_argument("--top", type=int, default=84, help="pixels to cut from the top")
    ap.add_argument("--bottom", type=int, default=56, help="pixels to cut from the bottom")
    ap.add_argument("--left", type=int, default=0)
    ap.add_argument("--right", type=int, default=0)
    ap.add_argument("--preview", action="store_true", help="write one cropped frame per recording and stop")
    args = ap.parse_args()

    recordings = sorted(p for p in args.recordings.iterdir() if p.suffix.lower() in VIDEOS)
    if not recordings:
        raise SystemExit(f"no recordings in {args.recordings}")
    args.out.mkdir(parents=True, exist_ok=True)
    for i, src in enumerate(recordings, start=1):
        if args.preview:
            cap = cv2.VideoCapture(str(src))
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) // 3)
            ok, frame = cap.read()
            if ok:
                h, w = frame.shape[:2]
                cv2.imwrite(str(args.out / f"preview_{i:02d}.jpg"), frame[args.top : h - args.bottom, args.left : w - args.right])
            continue
        dst = args.out / f"play_{i:02d}.mp4"
        frames = crop_clip(src, dst, args.top, args.bottom, args.left, args.right)
        print(f"{src.name} -> {dst.name} ({frames} frames)")


if __name__ == "__main__":
    main()

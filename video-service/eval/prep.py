"""Turns screen recordings of Hudl's player into clips the pipeline can read.

    python -m eval.prep recordings/ --out clips/ --top 84 --bottom 56

A screen recording of Hudl has the player's own chrome around the film: the tag bar across the top
(PLAY #, OFF FORM, OFF PLAY, ...), the controls along the bottom, a black margin. Those are bright
text and lines that the field finder would take for paint, so they are cut off here, and the
clips are written as `play_01.mp4`, `play_02.mp4`, ... in the order of the recordings' names
(or, with `--by-tag`, nothing is guessed: the order of the file names is the order of the plays).

For the 1470 x 956 recordings Hudl's web player makes on a Mac, `--top 84 --bottom 56` leaves just
the film. Check one frame (`--preview`) before cutting a whole folder.

A recording often starts or ends on the desktop (the browser window, the play list) before the player goes full screen
or after it leaves. Those frames aren't film, so only the longest run of full-screen frames is kept (`player_frames`: the
full-screen player's top strip is black, the desktop's menu bar isn't), less `EDGE_FRAMES` either side of a switch, which
can catch the zoom into full screen. `--keep-all` turns that off. `--plays 66,67,96,97` names the clips by play number
(`play_66.mp4`) in the recordings' order, so they line up with the breakdown's rows.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2

VIDEOS = {".mp4", ".mov", ".m4v"}

# The top this many rows of a full-screen player frame are black (mean under `DARK_TOP`); the desktop's menu bar is not.
TOP_ROWS = 28
DARK_TOP = 12.0
# Frames dropped beside a switch between the desktop and the full-screen player (the zoom into full screen).
EDGE_FRAMES = 6


def player_frames(top_means: list[float]) -> tuple[int, int] | None:
    """The first and last frame of the longest run of full-screen player frames, or None if there is none."""
    best: tuple[int, int] | None = None
    start = None
    for i, m in enumerate([*top_means, 255.0]):
        if m < DARK_TOP and start is None:
            start = i
        elif m >= DARK_TOP and start is not None:
            if best is None or i - 1 - start > best[1] - best[0]:
                best = (start, i - 1)
            start = None
    if best is None:
        return None
    first = best[0] + (EDGE_FRAMES if best[0] > 0 else 0)
    last = best[1] - (EDGE_FRAMES if best[1] < len(top_means) - 1 else 0)
    return (first, last) if last > first else None


def crop_clip(src: Path, dst: Path, top: int, bottom: int, left: int = 0, right: int = 0, keep_all: bool = False) -> int:
    cap = cv2.VideoCapture(str(src))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    box = (left, top, w - right, h - bottom)
    frames, tops = [], []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(frame[box[1] : box[3], box[0] : box[2]])
        tops.append(float(frame[:TOP_ROWS].mean()))
    span = (0, len(frames) - 1) if keep_all else player_frames(tops)
    if span is None:
        raise SystemExit(f"{src.name}: no full-screen player frames (a recording of the desktop?); --keep-all to cut it anyway")
    out = cv2.VideoWriter(str(dst), cv2.VideoWriter_fourcc(*"mp4v"), fps, (box[2] - box[0], box[3] - box[1]))
    for frame in frames[span[0] : span[1] + 1]:
        out.write(frame)
    out.release()
    return span[1] - span[0] + 1


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("recordings", type=Path)
    ap.add_argument("--out", type=Path, default=Path("clips"))
    ap.add_argument("--top", type=int, default=84, help="pixels to cut from the top")
    ap.add_argument("--bottom", type=int, default=56, help="pixels to cut from the bottom")
    ap.add_argument("--left", type=int, default=0)
    ap.add_argument("--right", type=int, default=0)
    ap.add_argument("--preview", action="store_true", help="write one cropped frame per recording and stop")
    ap.add_argument("--keep-all", action="store_true", help="keep every frame, desktop included")
    ap.add_argument("--plays", default="", help="play numbers in the recordings' order (66,67,96): names the clips play_66.mp4 ...")
    args = ap.parse_args()

    recordings = sorted(p for p in args.recordings.iterdir() if p.suffix.lower() in VIDEOS)
    if not recordings:
        raise SystemExit(f"no recordings in {args.recordings}")
    plays = [p.strip() for p in args.plays.split(",") if p.strip()]
    if plays and len(plays) != len(recordings):
        raise SystemExit(f"--plays names {len(plays)} plays for {len(recordings)} recordings")
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
        dst = args.out / (f"play_{int(plays[i - 1]):02d}.mp4" if plays else f"play_{i:02d}.mp4")
        frames = crop_clip(src, dst, args.top, args.bottom, args.left, args.right, args.keep_all)
        print(f"{src.name} -> {dst.name} ({frames} frames)")


if __name__ == "__main__":
    main()

"""Cut a long game video into plays: one clip per snap, ready for `eval.game` or the hosted worker.

    python -m eval.split game.mp4 --out clips/ [--plan plan.json] [--plot energy.png]

Hudl exports one clip a play. Film that doesn't come from Hudl (a press-box recording of a whole half or game)
is hours of plays, huddles, timeouts and cutaways, so before anything can be read the plays have to be found.

How: one pass over the video at a few frames a second (decoding dominates; everything else is tiny) gives
three numbers a sample: how much the picture moved, how much of it is grass, and whether there was a hard cut.
A snap is the plain shape every play has, a quiet set (the offense standing still, a second or so) and then a
sustained burst of motion (everyone moving at once), on footage that is the field. Thresholds are relative to
the film's own motion (its 95th percentile on field footage), so a zoomed-out press box and a close sideline
camera both work without tuning, and each is checked against the grass fraction (a crowd shot, a replay graphic
or a scoreboard is not) and against hard cuts at the snap (a cut means the camera changed, so the set was not
seen). Each play gets `PRE_SECONDS` of set before the snap and runs to where the motion dies (at most
`MAX_AFTER_SECONDS`), never into the next play's set.

What it cannot know: a replay of a play is another burst on the same field, so it is cut as a second play; a
no-huddle snap with no quiet set is missed; a camera that pans fast between plays can read as a burst. Every
play carries a `score` (how clean the set-then-burst was) so the doubtful ones can be looked at, and `--plot`
draws the motion series with each snap marked, which is what to look at when real film behaves differently.
The thresholds are at the top; they were set on drawn film, not on a real game yet.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

SAMPLE_FPS = 5.0  # samples a second (a play lasts 5-9 s: plenty)
SMALL = (128, 72)  # what each sample is shrunk to
GREEN_MIN = 0.22  # fraction of grass in the picture for it to be field footage
CUT_CORRELATION = 0.55  # a histogram this unlike the last sample's is a hard cut
QUIET_SECONDS = 1.0  # the set before the snap
ACTIVE_SECONDS = 1.5  # the burst after it
ACTIVE_FRAC = 0.40  # the burst must be this much of the film's own play-level motion (its 95th percentile)
QUIET_RATIO = 0.50  # and the set at most this much of the burst
MIN_GAP_SECONDS = 8.0  # two snaps closer than this are one
PRE_SECONDS = 3.0  # kept before the snap, so the formation is seen
MIN_AFTER_SECONDS = 5.0
MAX_AFTER_SECONDS = 9.0  # the tracker follows 8 s from the snap
DIES_FRAC = 0.30  # the play is over when motion is below this much of the burst for `DIES_SECONDS`
DIES_SECONDS = 1.5
TAIL_SECONDS = 1.0


@dataclass
class Play:
    start: float
    snap: float
    end: float
    score: float
    green: float


@dataclass
class Series:
    sample_fps: float
    motion: np.ndarray
    green: np.ndarray
    cut: np.ndarray
    duration: float

    def __len__(self) -> int:
        return len(self.motion)


def read_series(path: Path | str, progress: Callable[[float], None] | None = None) -> Series:
    """One pass over the video: motion, grass fraction and hard cuts, at `SAMPLE_FPS`."""
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError(f"cannot open {path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    step = max(1, round(fps / SAMPLE_FPS))
    motion: list[float] = []
    green: list[float] = []
    cut: list[bool] = []
    prev_gray = None
    prev_hist = None
    index = -1
    while True:
        if not cap.grab():  # grab decodes without converting: cheaper for the frames we skip
            break
        index += 1
        if index % step:
            continue
        ok, frame = cap.retrieve()
        if not ok:
            break
        small = cv2.resize(frame, SMALL, interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
        grass = (hsv[:, :, 0] >= 30) & (hsv[:, :, 0] <= 90) & (hsv[:, :, 1] >= 40) & (hsv[:, :, 2] >= 35)
        hist = cv2.calcHist([gray], [0], None, [32], [0, 256])
        cv2.normalize(hist, hist, 1.0, 0.0, cv2.NORM_L1)
        is_cut = False
        diff = 0.0
        if prev_gray is not None:
            is_cut = cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL) < CUT_CORRELATION
            diff = 0.0 if is_cut else float(np.mean(cv2.absdiff(gray, prev_gray)))
        motion.append(diff)
        green.append(float(grass.mean()))
        cut.append(bool(is_cut))
        prev_gray, prev_hist = gray, hist
        if progress and total and len(motion) % 500 == 0:
            progress(min(1.0, (index + 1) / total))
    cap.release()
    sample_fps = fps / step
    return Series(sample_fps, np.array(motion), np.array(green), np.array(cut), len(motion) / sample_fps)


def find_plays(series: Series) -> list[Play]:
    """The snaps in a series: a quiet set, then a sustained burst, on field footage, with no cut at the snap."""
    sr = series.sample_fps
    n = len(series)
    if n < int((QUIET_SECONDS + ACTIVE_SECONDS + 1) * sr):
        return []
    field = series.green >= GREEN_MIN
    if field.sum() < 10:
        return []
    # The film's own play-level motion: its 95th percentile on field footage (so crowd shots can't set it).
    scale = float(np.percentile(series.motion[field], 95))
    if scale <= 0:
        return []

    quiet_w, active_w = max(1, round(QUIET_SECONDS * sr)), max(2, round(ACTIVE_SECONDS * sr))
    csum = np.concatenate([[0.0], np.cumsum(series.motion)])

    def mean(a: int, b: int) -> float:
        a, b = max(0, a), min(n, b)
        return float((csum[b] - csum[a]) / (b - a)) if b > a else 0.0

    cut_at = np.flatnonzero(series.cut)

    def cut_near(t: int) -> bool:
        lo, hi = t - round(1.0 * sr), t + round(1.5 * sr)
        return bool(len(cut_at) and np.any((cut_at >= lo) & (cut_at <= hi)))

    candidates: list[tuple[float, int]] = []
    for t in range(quiet_w, n - active_w):
        active, quiet = mean(t, t + active_w), mean(t - quiet_w, t)
        if active < ACTIVE_FRAC * scale or quiet > QUIET_RATIO * active:
            continue
        lo, hi = max(0, t - round(2 * sr)), min(n, t + round(1 * sr))
        if np.median(series.green[lo:hi]) < GREEN_MIN or cut_near(t):
            continue
        candidates.append((active - quiet, t))

    # Strongest first, keeping any that isn't within `MIN_GAP_SECONDS` of one already kept.
    kept: list[int] = []
    for _, t in sorted(candidates, reverse=True):
        if all(abs(t - k) >= MIN_GAP_SECONDS * sr for k in kept):
            kept.append(t)
    kept.sort()

    plays: list[Play] = []
    for i, t in enumerate(kept):
        # The snap is where the burst really starts: the first sample in the window where motion is past half of it.
        burst = mean(t, t + active_w)
        snap_i = t
        for j in range(max(0, t - round(0.6 * sr)), min(n, t + active_w)):
            if series.motion[j] >= 0.5 * burst:
                snap_i = j
                break
        snap = snap_i / sr
        # The play ends where the motion dies (not before MIN_AFTER, not after MAX_AFTER, not into the next set).
        end_i = snap_i
        dies = round(DIES_SECONDS * sr)
        limit = min(n, snap_i + round(MAX_AFTER_SECONDS * sr))
        j = snap_i + round(MIN_AFTER_SECONDS * sr)
        end_i = limit
        while j < limit - dies:
            if mean(j, j + dies) < DIES_FRAC * burst or series.cut[j]:
                end_i = j
                break
            j += 1
        end = min(series.duration, end_i / sr + TAIL_SECONDS)
        end = max(end, snap + MIN_AFTER_SECONDS)
        if i + 1 < len(kept):
            end = min(end, kept[i + 1] / sr - PRE_SECONDS - 0.2)
        if end <= snap + 1.0:
            continue
        rise = mean(t, t + active_w) - mean(t - quiet_w, t)
        plays.append(
            Play(
                start=max(0.0, snap - PRE_SECONDS),
                snap=snap,
                end=end,
                score=float(min(1.0, rise / scale)),
                green=float(np.median(series.green[max(0, snap_i - round(2 * sr)) : snap_i + 1])),
            )
        )
    return plays


def split_video(path: Path | str, progress: Callable[[float], None] | None = None) -> tuple[list[Play], Series]:
    series = read_series(path, progress)
    return find_plays(series), series


def cut_clips(source: Path | str, plays: list[Play], out_dir: Path, first_number: int = 1) -> list[Path]:
    """Writes each play as `play_<n>.mp4` (the number is what the app lines a clip up with a sheet's row by)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        raise ValueError(f"cannot open {source}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    size = (int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    paths: list[Path] = []
    for offset, play in enumerate(plays):
        path = out_dir / f"play_{first_number + offset:03d}.mp4"
        write_range(cap, fps, size, play.start, play.end, path)
        paths.append(path)
    cap.release()
    return paths


def write_range(cap: "cv2.VideoCapture", fps: float, size: tuple[int, int], start: float, end: float, path: Path) -> int:
    """One stretch of an open video, as its own clip. Returns the frames written."""
    cap.set(cv2.CAP_PROP_POS_FRAMES, round(start * fps))
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    written = 0
    for _ in range(max(1, round((end - start) * fps))):
        ok, frame = cap.read()
        if not ok:
            break
        writer.write(frame)
        written += 1
    writer.release()
    return written


def plot(series: Series, plays: list[Play], path: Path) -> None:
    """The motion series with each snap marked (green = field footage), for tuning on real film."""
    w, h = 1800, 360
    img = np.full((h, w, 3), 24, np.uint8)
    n = len(series)
    if n < 2:
        cv2.imwrite(str(path), img)
        return
    top = max(float(np.percentile(series.motion, 99.5)), 1e-6)
    xs = np.linspace(0, w - 1, n)
    for i in range(n):
        x = int(xs[i])
        color = (70, 150, 70) if series.green[i] >= GREEN_MIN else (90, 90, 90)
        y = int(h - 20 - min(1.0, series.motion[i] / top) * (h - 60))
        cv2.line(img, (x, h - 20), (x, y), color, 1)
        if series.cut[i]:
            cv2.line(img, (x, 0), (x, 20), (60, 60, 200), 1)
    for p in plays:
        x = int(p.snap / series.duration * (w - 1))
        cv2.line(img, (x, 20), (x, h - 20), (0, 140, 255), 1)
        cv2.rectangle(img, (int(p.start / series.duration * (w - 1)), h - 18), (int(p.end / series.duration * (w - 1)), h - 12), (0, 140, 255), -1)
    cv2.putText(img, f"{len(plays)} plays  ·  {series.duration / 60:.1f} min  ·  orange = snap and kept range, red tick = cut", (10, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1)
    cv2.imwrite(str(path), img)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", type=Path)
    ap.add_argument("--out", type=Path, default=Path("clips"), help="where the clips go")
    ap.add_argument("--plan", type=Path, help="also write the plays (start, snap, end, score) as JSON")
    ap.add_argument("--plot", type=Path, help="draw the motion series with each snap marked (a PNG)")
    ap.add_argument("--first", type=int, default=1, help="number the first clip this (for a second half: continue the count)")
    ap.add_argument("--dry-run", action="store_true", help="find the plays but don't cut clips")
    args = ap.parse_args()

    plays, series = split_video(args.video, progress=lambda f: print(f"\r  reading {f:.0%}", end="", flush=True))
    print(f"\n{len(plays)} plays in {series.duration / 60:.1f} min")
    for i, p in enumerate(plays, start=args.first):
        print(f"  play_{i:03d}  snap {p.snap:7.1f} s  ({p.start:7.1f}-{p.end:7.1f})  score {p.score:.2f}")
    if args.plan:
        args.plan.write_text(json.dumps({"duration": series.duration, "plays": [asdict(p) for p in plays]}, indent=2))
    if args.plot:
        plot(series, plays, args.plot)
    if not args.dry_run and plays:
        cut_clips(args.video, plays, args.out, args.first)
        print(f"clips in {args.out}/")


if __name__ == "__main__":
    main()

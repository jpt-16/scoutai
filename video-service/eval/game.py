"""A whole game in one command: clips in, scout cards out.

    python -m eval.game clips/ --sheet hudl.csv --out game.json [--key corrected.csv]

For every clip in the folder this (1) calibrates it with `eval.autocalib` unless a `.json`
is already beside it (a hand calibration from `eval.calibrate` always wins), (2) reads the
formation before the snap (`eval.presnap`), (3) follows every player through the play
(`eval.tracks`), and then hands the tracks to `scripts/tracks-to-cards.ts`, which names each
route, reads each run (scheme and direction) and each defense (front, every defender's spot, and the
secondary per formation), lines the plays up with the Hudl sheet's rows and writes `game.json`. Open that
on the app's landing page. With `--key` (the coach's corrected breakdown) it then scores the reads:
routes, run or pass, run schemes, fronts (`scripts/score-routes.ts`).

Detection runs on the field only, at one man size (`--region`, see `eval.regiondetect`); `--tiles` is the
old whole-frame grid, used with `--no-region`.

Clips it can't calibrate are listed at the end and left out of the cards (the sheet still
draws their rows); calibrate those by hand with `python -m eval.calibrate <clip>` and run
this again, which only redoes what is missing.
"""

from __future__ import annotations

import argparse
import csv
import subprocess
from pathlib import Path

from .clipjob import FAILED, NEEDS_HAND, process_clip
from .presnap import Detector

REPO = Path(__file__).resolve().parents[2]
VIDEOS = {".mp4", ".mov", ".m4v"}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("clips", type=Path)
    ap.add_argument("--sheet", type=Path, help="Hudl's breakdown (CSV) for this game")
    ap.add_argument("--out", type=Path, default=Path("game.json"))
    ap.add_argument("--work", type=Path, default=Path("game-work"), help="where tracks and debug pictures go")
    ap.add_argument("--seconds", type=float, default=8.0, help="how long after the snap to follow")
    ap.add_argument("--tiles", type=int, default=3)
    ap.add_argument("--no-region", dest="region", action="store_false", help="tile the whole frame instead of the field")
    ap.add_argument("--key", type=Path, help="the coach's corrected breakdown (CSV): score the reads against it")
    ap.add_argument("--scout-color", default=None, help="the jersey color of the team being scouted (red, gold, blue...): each play says which side of the ball it is on, so only its offense makes Scout O cards and only its defense Scout D cards")
    ap.add_argument("--detections", action="store_true", help="also save every detection (work/detections), to tune without the film")
    args = ap.parse_args()

    clips = sorted(p for p in args.clips.iterdir() if p.suffix.lower() in VIDEOS)
    if not clips:
        raise SystemExit(f"no clips in {args.clips}")
    tracks_dir, debug_dir = args.work / "tracks", args.work / "debug"
    tracks_dir.mkdir(parents=True, exist_ok=True)
    detector = Detector()
    print(f"{len(clips)} clips, detector on {detector.device}")

    needs_hand: list[tuple[str, str]] = []
    forms: list[dict] = []
    detections = args.work / "detections" if args.detections else None
    for i, clip in enumerate(clips, start=1):
        result = process_clip(
            clip, detector, tracks_dir, debug_dir,
            seconds=args.seconds, tiles=args.tiles, region=args.region, detections_dir=detections, scout_color=args.scout_color,
        )
        if result.status == NEEDS_HAND:
            needs_hand.append((clip.name, result.reason))
            print(f"[{i}/{len(clips)}] {clip.name}: needs a hand ({result.reason})")
            continue
        if result.status == FAILED:
            raise SystemExit(f"{clip.name}: {result.reason}")
        forms.append(result.row(i))
        took = sum(v for k, v in result.timing.items() if k.endswith("_seconds"))
        timing = f"  ({took:.0f} s)" if took else ""
        print(f"[{i}/{len(clips)}] {clip.name}: {result.formation} {result.strength}{timing}")

    formations = args.work / "ours.csv"
    with formations.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["PLAY #", "OFF FORM", "OFF STR"])
        writer.writeheader()
        writer.writerows(forms)

    cmd = ["npx", "--yes", "jiti", "scripts/tracks-to-cards.ts", str(tracks_dir.resolve()), "--formations", str(formations.resolve()),
           "--out", str(args.out.resolve())]
    if args.sheet:
        cmd += ["--sheet", str(args.sheet.resolve())]
    subprocess.run(cmd, cwd=REPO, check=True)
    if args.key:
        print("\nScore against the key:")
        subprocess.run(["npx", "--yes", "jiti", "scripts/score-routes.ts", str(tracks_dir.resolve()), "--key", str(args.key.resolve())], cwd=REPO, check=True)
    if needs_hand:
        print(f"\n{len(needs_hand)} clips need `python -m eval.calibrate <clip>`, then run this again:")
        for name, reason in needs_hand:
            print(f"  {name}: {reason}")


if __name__ == "__main__":
    main()

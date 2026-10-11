"""A whole game in one command: clips in, scout cards out.

    python -m eval.game clips/ --sheet hudl.csv --out game.json

For every clip in the folder this (1) calibrates it with `eval.autocalib` unless a `.json`
is already beside it (a hand calibration from `eval.calibrate` always wins), (2) reads the
formation before the snap (`eval.presnap`), (3) follows every player through the play
(`eval.tracks`), and then hands the tracks to `scripts/tracks-to-cards.ts`, which names each
route, lines the plays up with the Hudl sheet's rows and writes `game.json`. Open that on the
app's landing page.

Clips it can't calibrate are listed at the end and left out of the cards (the sheet still
draws their rows); calibrate those by hand with `python -m eval.calibrate <clip>` and run
this again, which only redoes what is missing.
"""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
from pathlib import Path

from .autocalib import SceneFailure, auto_calibrate
from .field import FieldFailure
from .presnap import Detector, play_number, read_clip
from .tracks import track_clip

REPO = Path(__file__).resolve().parents[2]
VIDEOS = {".mp4", ".mov", ".m4v"}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("clips", type=Path)
    ap.add_argument("--sheet", type=Path, help="Hudl's breakdown (CSV) for this game")
    ap.add_argument("--out", type=Path, default=Path("game.json"))
    ap.add_argument("--work", type=Path, default=Path("game-work"), help="where tracks and debug pictures go")
    ap.add_argument("--seconds", type=float, default=6.0, help="how long after the snap to follow")
    ap.add_argument("--tiles", type=int, default=2)
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
    for i, clip in enumerate(clips, start=1):
        calib = clip.with_suffix(".json")
        if not calib.exists():
            result = auto_calibrate(clip, detector, args.tiles, debug_dir)
            if isinstance(result, (FieldFailure, SceneFailure)):
                needs_hand.append((clip.name, result.reason))
                print(f"[{i}/{len(clips)}] {clip.name}: needs a hand ({result.reason})")
                continue
            calib.write_text(json.dumps(result, indent=2))
        formation = read_clip(clip, detector, args.tiles, debug_dir)["formation"]
        forms.append({"PLAY #": play_number(clip, i), "OFF FORM": formation.key, "OFF STR": formation.strength or ""})
        out = tracks_dir / f"{clip.stem}.json"
        if not out.exists():
            out.write_text(json.dumps(track_clip(clip, detector, args.seconds, args.tiles)))
        print(f"[{i}/{len(clips)}] {clip.name}: {formation.key} {formation.strength or ''}")

    formations = args.work / "ours.csv"
    with formations.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["PLAY #", "OFF FORM", "OFF STR"])
        writer.writeheader()
        writer.writerows(forms)

    cmd = ["npx", "jiti", "scripts/tracks-to-cards.ts", str(tracks_dir.resolve()), "--formations", str(formations.resolve()),
           "--out", str(args.out.resolve())]
    if args.sheet:
        cmd += ["--sheet", str(args.sheet.resolve())]
    subprocess.run(cmd, cwd=REPO, check=True)
    if needs_hand:
        print(f"\n{len(needs_hand)} clips need `python -m eval.calibrate <clip>`, then run this again:")
        for name, reason in needs_hand:
            print(f"  {name}: {reason}")


if __name__ == "__main__":
    main()

"""Scores formation tags against what a coach corrected them to.

    python -m eval.score --hudl hudl.csv --corrected corrected.csv [--ours ours.csv]

`hudl.csv` is the breakdown as Hudl Assist tagged it, `corrected.csv` is the same game
after the coach fixed it (the answer key), and `ours.csv` is what `presnap.py` read
from the clips (columns: play, formation, strength). Every row is matched by its play
number and its formation read through the app's own vocabulary (`vocab.py`), so
"Trips Rt" and "TRIO RI" are the same shape.
"""

from __future__ import annotations

import argparse
import csv
from collections import Counter
from pathlib import Path

from .vocab import classify_formation, parse_side

PLAY_COLUMNS = ["PLAY #", "PLAY#", "PLAY NO", "PLAY NUMBER", "PLAY"]
FORMATION_COLUMNS = ["OFF FORM", "OFF FORMATION", "FORMATION", "OFF FORM NAME", "FORM"]
STRENGTH_COLUMNS = ["OFF STR", "OFF STRENGTH", "STRENGTH", "STR"]

# Pro and I-form are one shape to the app's cards (I-backs), so they count as one family.
FAMILY = {"i-form": "pro"}


def family(key: str) -> str:
    return FAMILY.get(key, key)


def _norm(header: str) -> str:
    return " ".join(header.replace("﻿", "").upper().replace(".", " ").replace("_", " ").split())


def _column(headers: list[str], names: list[str]) -> str | None:
    by_norm = {_norm(h): h for h in headers}
    for name in names:
        if name in by_norm:
            return by_norm[name]
    return None


def read_formations(path: Path) -> dict[str, tuple[str, str | None]]:
    """play number -> (formation key, strength side) for a Hudl-style CSV."""
    with path.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        return {}
    headers = list(rows[0].keys())
    play_col = _column(headers, PLAY_COLUMNS)
    form_col = _column(headers, FORMATION_COLUMNS)
    str_col = _column(headers, STRENGTH_COLUMNS)
    if not form_col:
        raise SystemExit(f"{path}: no formation column (looked for {', '.join(FORMATION_COLUMNS)})")
    out: dict[str, tuple[str, str | None]] = {}
    for i, row in enumerate(rows, start=1):
        play = (row.get(play_col) or "").strip() if play_col else ""
        play = play if play.isdigit() else str(i)
        text = (row.get(form_col) or "").strip()
        side = parse_side(text) or parse_side(f" {(row.get(str_col) or '').strip()} " if str_col else "")
        out[play] = (classify_formation(text), side)
    return out


def score(
    answers: dict[str, tuple[str, str | None]],
    predictions: dict[str, tuple[str, str | None]],
) -> dict:
    """Accuracy of `predictions` against `answers`, on plays whose answer is a known shape."""
    plays = [p for p, (key, _) in answers.items() if key != "unknown" and p in predictions]
    exact = sum(predictions[p][0] == answers[p][0] for p in plays)
    fam = sum(family(predictions[p][0]) == family(answers[p][0]) for p in plays)
    with_side = [p for p in plays if answers[p][1] and predictions[p][1]]
    side = sum(predictions[p][1] == answers[p][1] for p in with_side)
    confusion = Counter((answers[p][0], predictions[p][0]) for p in plays if predictions[p][0] != answers[p][0])
    return {
        "plays": len(plays),
        "exact": exact,
        "family": fam,
        "side_plays": len(with_side),
        "side": side,
        "confusion": confusion,
    }


def _line(label: str, s: dict) -> str:
    n = s["plays"]
    if n == 0:
        return f"{label:<14} no plays to compare"
    side = f", strength side {s['side']}/{s['side_plays']}" if s["side_plays"] else ""
    return f"{label:<14} formation {s['exact']}/{n} ({s['exact'] / n:.0%}), same family {s['family']}/{n} ({s['family'] / n:.0%}){side}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--hudl", type=Path, required=True, help="the breakdown as Hudl Assist tagged it")
    ap.add_argument("--corrected", type=Path, required=True, help="the same game after the coach fixed it")
    ap.add_argument("--ours", type=Path, help="our reading of the clips (play, formation, strength)")
    args = ap.parse_args()

    answers = read_formations(args.corrected)
    results = {"Hudl Assist": score(answers, read_formations(args.hudl))}
    if args.ours:
        results["ScoutCard"] = score(answers, read_formations(args.ours))
    print(f"Against {args.corrected.name} ({len(answers)} plays)\n")
    for label, s in results.items():
        print(_line(label, s))
    for label, s in results.items():
        if s["confusion"]:
            print(f"\n{label} got these wrong (coach said -> tagged):")
            for (want, got), n in s["confusion"].most_common():
                print(f"  {want:<13} -> {got:<13} x{n}")


if __name__ == "__main__":
    main()

"""Tests for the pure parts of eval/: the vocabulary, the formation rules and the scorer.
Run with `python -m pytest test_eval.py` (needs nothing but pytest)."""

import re
from pathlib import Path

from eval.formation import Spot, classify
from eval.score import read_formations, score
from eval.vocab import FORMATION_PATTERNS, classify_formation, parse_side

HUDL_PARSER = Path(__file__).resolve().parent.parent / "src" / "lib" / "hudlParser.ts"


def test_vocab_matches_the_app():
    # Every pattern here must still be in classifyFormation, so the two can't drift.
    ts = HUDL_PARSER.read_text()
    for pattern, _ in FORMATION_PATTERNS:
        assert "/" + pattern + "/" in ts.replace("\\s", "\\s"), pattern


def test_vocab_reads_the_staffs_names():
    assert classify_formation("Pro rt") == "pro"
    assert classify_formation("Twins Rt") == "pro"
    assert classify_formation("Aces Right") == "spread"
    assert classify_formation("Duces Gun") == "spread"
    assert classify_formation("Trio RI") == "trips"
    assert classify_formation("") == "unknown"
    assert parse_side("Trips Rt") == "right"
    assert parse_side("Pro Lt") == "left"
    assert parse_side("Duces Gun") is None


def line(*xs):
    return [Spot(x, 0.0) for x in xs]


def test_trips_right_shotgun():
    offense = line(-4, -2, 0, 2, 4) + [
        Spot(0, -5),  # Q, shotgun
        Spot(1.5, -5),  # back
        Spot(-15, 0),  # X, split left
        Spot(9, 0), Spot(13, -1), Spot(19, 0),  # three to the right
    ]
    f = classify(offense)
    assert (f.key, f.strength) == ("trips", "right")


def test_deuces_is_spread_with_the_strength_to_the_side_with_more():
    offense = line(-4, -2, 0, 2, 4) + [Spot(0, -5), Spot(2, -5), Spot(-14, 0), Spot(-9, -1), Spot(13, 0), Spot(17, 0)]
    f = classify(offense)
    assert f.key == "spread"


def test_under_center_two_backs_stacked_is_pro_and_side_by_side_is_split_pro():
    base = line(-4, -2, 0, 2, 4) + [Spot(0, -1), Spot(-14, 0), Spot(14, 0)]
    stacked = classify(base + [Spot(0, -4), Spot(0, -6.5)])
    split = classify(base + [Spot(-2.5, -4.5), Spot(2.5, -4.5)])
    assert stacked.key == "pro"
    assert split.key == "split-pro"


def test_two_tight_ends_is_double_eagle():
    offense = line(-4, -2, 0, 2, 4) + [Spot(-6.5, 0), Spot(6.5, 0), Spot(0, -1), Spot(0, -5), Spot(-15, 0), Spot(15, 0)]
    assert classify(offense).key == "double-eagle"


def test_too_few_players_is_unknown_not_a_guess():
    assert classify(line(-2, 0, 2)).key == "unknown"


def _write(path: Path, rows: list[str]) -> Path:
    path.write_text("PLAY #,OFF FORM\n" + "\n".join(rows) + "\n")
    return path


def test_scorer_counts_hudl_and_ours_against_the_corrected_sheet(tmp_path):
    answers = read_formations(_write(tmp_path / "c.csv", ["1,Trips Rt", "2,Pro Lt", "3,Duces Gun", "4,REX"]))
    hudl = read_formations(_write(tmp_path / "h.csv", ["1,Trips Rt", "2,Duces", "3,Duces Gun", "4,Pro"]))
    ours = read_formations(_write(tmp_path / "o.csv", ["1,Trips", "2,I Form", "3,Trips", "4,Pro"]))
    # Play 4's answer is a name the app doesn't know, so it isn't scored.
    assert score(answers, hudl)["plays"] == 3
    assert score(answers, hudl)["exact"] == 2
    s = score(answers, ours)
    assert (s["exact"], s["family"]) == (1, 2)  # I-form counts as the same family as Pro
    assert s["confusion"][("spread", "trips")] == 1

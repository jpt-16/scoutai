# Formation check: are we beating Hudl Assist?

Reads the offense's formation off one frame of each clip and scores it, and Hudl
Assist's own tags, against what your coach corrected them to. Runs on a Mac (an M-series
chip uses its own GPU) and the film never leaves it.

## What you need

- The clips, one per play, named with the play number (`play_01.mp4`, `Play 4.mov`).
- `hudl.csv`: the breakdown as Hudl Assist tagged it.
- `corrected.csv`: the same game after your coach fixed it. Both just need a play
  number and a formation column (`OFF FORM`).

**Keep the clips out of git.** `video-service/clips/` is ignored; put them there.

## One-time setup (Terminal, from the repo)

```bash
cd video-service
python3 -m venv .venv && source .venv/bin/activate
pip install torch
pip install -r requirements-eval.txt
python -m pytest -q test_eval.py test_presnap.py   # should pass
```

## Each time

```bash
# 1. Once per clip: step to the frame just before the snap, click four spots where a
#    yard line meets a hash or sideline, click the ball, say which way the offense goes.
python -m eval.calibrate clips/play_01.mp4

# 2. Read every calibrated clip. --debug saves a picture of each so you can see who it
#    found (green = offense, red = defense) and what it called the formation.
python -m eval.presnap clips/ --out ours.csv --debug debug/

# 3. Score: Hudl Assist vs ScoutCard, both against your coach's corrections.
python -m eval.score --hudl hudl.csv --corrected corrected.csv --ours ours.csv
```

The score shows exact formation matches, "same family" (Pro and I-form are one shape on
a card), the strength side, and which formations get mixed up for which.

## When it's wrong

Open the picture in `debug/`. A missing player means the detector missed him (try
`--tiles 3`); players in the wrong place mean the four calibration spots were off;
players in the wrong color group mean the team split failed (referees and occlusion are
the usual causes). If all of that looks right and the name is still wrong, the rule is
in `formation.py`, and its thresholds are at the top of the file.

Not yet checked against real game film: expect to tune on the first batch.

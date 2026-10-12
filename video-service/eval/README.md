# Formation check: are we beating Hudl Assist?

Reads the offense's formation off one frame of each clip and scores it, and Hudl
Assist's own tags, against what your coach corrected them to. Runs on a Mac (an M-series
chip uses its own GPU) and the film never leaves it.

## What you need

- The clips, one per play, named with the play number (`play_01.mp4`, `Play 4.mov`).
- `hudl.csv`: the breakdown as Hudl Assist tagged it.
- `corrected.csv`: the same game after your coach fixed it. Both just need a play
  number and a formation column (`OFF FORM`).

  **Easiest way to get both:** in the app, open the game's script, tap **Review**, check the plays
  (Looks right / Fix), then **Scorecard** and download **As tagged** and **Corrected**. Those two files
  are exactly this pair, for the plays that were checked.

**Keep the clips out of git.** `video-service/clips/` is ignored; put them there.

## One-time setup (Terminal)

First get the code onto the Mac. If you don't have the repo yet:

```bash
cd ~/Documents
git clone -b claude/scoutcard-ai-v1-scaffold-c4bgpf https://github.com/jpt-16/scoutai.git
cd scoutai
```

(No git? On github.com open the repo, switch to the `claude/scoutcard-ai-v1-scaffold-c4bgpf`
branch, then Code > Download ZIP, unzip it, and `cd` into the folder.) If you already have
it, `git pull` on that branch. `pwd` and `ls` should show a `video-service` folder.

Then:

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

## Routes (scout offense): follow the players, name the routes

Same calibrated clips. This follows every player for a few seconds after the snap, holding the
camera still on paper (the camera pans and zooms with the play), and writes where each went in yards:

```bash
python -m eval.tracks clips/ --out tracks/ --seconds 5     # from video-service/ (needs the detector, like presnap)
cd ..                                                      # the repo root, where `npm install` was run
npx jiti scripts/read-routes.ts video-service/tracks/play_01.json
```

The second command names each offensive player's route with the same reader the cards use
(`src/lib/routeReader.ts`): the route, how sure it is, and its next two guesses. Plays it isn't sure
about are the ones to look at. `test_tracks.py` checks the whole path on a drawn clip with a panning,
zooming camera (paths back within about a fifth of a yard, routes named right) and shows the same clip with
the camera motion ignored comes out wrong, so the test isn't passing by accident.

## When it's wrong

Open the picture in `debug/`. A missing player means the detector missed him (try
`--tiles 3`); players in the wrong place mean the four calibration spots were off;
players in the wrong color group mean the team split failed (referees and occlusion are
the usual causes). If all of that looks right and the name is still wrong, the rule is
in `formation.py`, and its thresholds are at the top of the file.

Not yet checked against real game film: expect to tune on the first batch.

## No clicking: calibrate a whole game

```bash
python -m eval.autocalib clips/             # writes clips/<name>.json for every clip it can read
python -m eval.autocalib clips/ --force     # redo clips that already have one
python -m eval.game clips/ --sheet hudl.csv --out game.json   # calibrate + formation + tracks + cards
```

Look at `debug/<clip>_auto.jpg` for a few clips first: the yellow lines are the yard lines it
believes in, the blue lines the sideline / hash rows, the red dot the ball. If those sit on the
paint and the dot on the center, trust the rest. A clip it can't read is listed with the reason
(`no_lines`, `rows`, `ambiguous_rows`, `fit`, `teams_did_not_separate`, ...); calibrate that one by
hand with `python -m eval.calibrate clips/<name>.mp4` and run `eval.game` again, which only redoes
what is missing. A hand `.json` is never overwritten.

## Screen recordings of Hudl's player

```bash
python -m eval.prep recordings/ --out clips/ --preview     # one cropped frame each: check it shows only the film
python -m eval.prep recordings/ --out clips/ --top 84 --bottom 56
```

Crops off the tag bar and the controls and names the clips `play_01.mp4`, `play_02.mp4`, ... in the order of
the recordings' file names, so name them in play order. Keep the tag bar visible in a few recordings and
write down what it says (PLAY #, OFF FORM, OFF STR, OFF PLAY, PLAY DIR): that is the answer key.

## Seeing the tracker's mistakes

    python -m eval.tracks clips/ --out tracks --seconds 8 --tiles 2 --debug debug/

Besides the track files, this writes `debug/<clip>_trk_<n>s.jpg` (a picture each second after the snap) and
`debug/<clip>_trk_sheet.jpg` (all of them on one sheet). Each person the tracker kept is boxed in his own track's
color with his number: thick box = offense, thin = defense, dashed grey = nobody is following him. The line behind a
box is where that track has been; a big red ring is a frame where a track moved faster than 14 yards a second, which
means it was handed to another man. The report printed after each clip lists those jumps and any offensive track
lost early. Look at the sheet to see who the track jumped to.

## Finding more of the men (the limit on every route read)

A route can only be read from frames where the man was found, and on the first real clips the smallest detector found a
receiver in under a third of the play's frames. `--debug` now prints "track N (offense) found in X% of the play's frames".
Try a bigger model and a lower confidence, and compare those percentages:

    MODEL_CHECKPOINT=PekingU/rtdetr_v2_r50vd python -m eval.tracks clips/ --out tracks --seconds 8 --tiles 3 --debug debug/
    MODEL_CHECKPOINT=PekingU/rtdetr_v2_r101vd DETECT_CONFIDENCE=0.3 python -m eval.tracks clips/ --out tracks --seconds 8 --tiles 3 --debug debug/

(`r18vd` is the default and the smallest; `r50vd` and `r101vd` are larger and slower, the first run of each downloads
the weights.) More tiles (3) look at the picture in more pieces, so small far players are bigger to the model.

## Saving what the detector found (so the tracking can be tuned without the film)

    python -m eval.tracks clips/ --out tracks --seconds 8 --tiles 3 --detections detections/

writes `detections/<clip>_detections.json` (it now also holds the RAW detector boxes with each box's jersey color and referee flag, and the camera, so `python -m eval.replay <file>` can re-run the filters and the tracker without the film or the detector): every person kept in every frame (yards from the ball in the offense's view,
jersey color, detector confidence, box), plus the tracker's own answer. It holds no film, only numbers, so it can be sent and
the tracking rules tried again and again elsewhere. Combine it with `MODEL_CHECKPOINT=PekingU/rtdetr_v2_r50vd` for the better detector.


## Running on a free GPU (Colab) instead of the Mac

`eval/colab_tracks.ipynb` runs the same `eval.tracks` command on a Colab T4: upload `colab_tracks.ipynb` at
colab.research.google.com, set the runtime to T4 GPU, and follow its cells (zip `video-service/` on the Mac, upload
it, run, download `results.zip`). The tracker picks CUDA by itself (`devices.py`). The clips are game film, so use
your own account and delete the runtime afterwards.

## Detecting only where the play is (`--region`)

    python -m eval.tracks clips/ --out tracks --seconds 8 --region --detections detections/

Holds the camera first, then runs the detector only on the field the tracker keeps people from (inside the sidelines,
25 yards either way of the ball), in rows of square windows cut so the farthest man in each row is about 90 pixels tall
to the model, however far the camera has zoomed (`eval/regiondetect.py`). Measured on play 3 with the whole-frame
tiles: the camera zoomed out 1.6x after the snap and the people found fell from 94 a frame to 61. Every run now prints a
`time:` line per clip (read, camera, detect, track, and windows per frame for `--region`). Compare two dumps of the same
clip with `python -m eval.compare a_detections.json b_detections.json`.

## Scoring the routes (the 90% goal)

    npx jiti scripts/score-routes.ts tracks/ --key corrected.csv

Lines every tracked play up with its row of the corrected breakdown (by the number in the clip's name), draws the
row's call into a route per receiver as the answer key (exactly as the card draws it), and prints each play
(`Z fade ✓ | Y speed-out ✗ (slide 0.09) | ...`) and the totals: routes right, how many the analyzer committed to
(drawn without a "check" note) and how many of those were right, blocking receivers read as blocking, and the most
common mistakes. Run it after every change; the goal is 90%+ of routes right.

## A whole game in one run (Colab)

`eval/colab_game.ipynb` runs `python -m eval.game` on a Colab T4: clips in, `game.json` out, and with the coach's
corrected breakdown, the score. Put the clips in `video-service/clips/` and the sheets (`hudl.csv`, `corrected.csv`) in
`video-service/`, zip the **whole project** (the notebook's first cell has the command; the cards and the score are the
app's own TypeScript, so Node runs there too), upload, Run all, download `game.json` and `results.zip`.

    python -m eval.game clips/ --sheet hudl.csv --key corrected.csv --out game.json --detections

calibrates each clip (a hand `.json` wins), reads the formation, tracks with `--region`, then
`scripts/tracks-to-cards.ts` reads routes, runs (`src/lib/runRead.ts`) and the defense (`src/lib/defenseRead.ts`) and
`scripts/score-routes.ts` prints routes right, run or pass right, run schemes and direction right, and fronts right.


## The hosted worker (what a coach's upload runs on)

`python -m eval.game` is for you at a desk. The app's **Game film** page (`/film`) uses the same per-clip step
(`eval.clipjob.process_clip`) behind a web server, so a coach never runs a notebook:

```bash
# from the repo root: build and run it on a GPU machine
docker build -f video-service/Dockerfile.worker -t scoutcard-worker .
docker run --gpus all -p 8080:8080 -e FILM_WORKER_SECRET=<a long random string> scoutcard-worker

# or without Docker, from video-service/ (needs Node and `npm install papaparse jiti` at the repo root)
FILM_WORKER_SECRET=... uvicorn eval.worker_server:app --host 0.0.0.0 --port 8080
```

Then set `FILM_WORKER_URL` (where it listens) and the same `FILM_WORKER_SECRET` in Vercel, plus `CRON_SECRET` for the daily
film cleanup. The app sends the worker **shards** (a few clips each) and, once every clip has reported, one **assemble**; see
`CLAUDE.md`'s "Game film upload" for the whole flow. Knobs: `WORKER_THREADS` (clips at once inside a shard, default up to
4), `SHARDS_AT_ONCE` (shards a box works on together, default 2). `GET /health` says whether the detector is loaded and
on what device. Tests: `pytest test_worker.py` (no GPU needed).


## A whole game's video (not one clip a play)

Hudl exports a clip a play. A recording of a whole half or game is hours of plays, huddles and cutaways, so cut it first:

```bash
python -m eval.split game.mp4 --out clips/ --plot energy.png --plan plan.json     # then: python -m eval.game clips/ ...
python -m eval.split second_half.mp4 --out clips/ --first 41                     # keep the numbering going for a second video
```

It finds each snap as a quiet set followed by a burst of motion, on footage that is the field (grass fraction), with no hard
cut at the snap, and writes `play_001.mp4` … with 3 s of set before each snap. `--plot` draws the motion with every snap
marked (orange); look at it when real film behaves differently, and tune the constants at the top of `split.py`
(`ACTIVE_FRAC`, `QUIET_RATIO`, `GREEN_MIN`, `MIN_GAP_SECONDS`). `--dry-run` finds the plays without cutting. It has only been
run on drawn film; a replay is cut as a second play, a no-huddle snap with no set is missed.

The hosted worker does the same on a `split` dispatch (reading the video over HTTP by range, so no whole download) and then
cuts each play out of the same video for its shard.


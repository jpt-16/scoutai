# The three real plays (Knights red vs Hawks gold: plays 8, 34, 43)

Hand calibrations (`play_08.json` at clip frame 130, `play_34.json` at 180 (it was 225, which is 0.4 s *after* the snap at about frame 212: tracking started mid-play, the snap was never found and the play read as a run; moved back through the paint registration), `play_43.json` at 180: each a second or two *before* the motion / snap),
the answer keys from Hudl's tag bar (`hudl.csv`, also `corrected.csv`), and the coach's own route truth (`truth.json`, for `scripts/score-truth.ts`).

The clips are not in the repo (minors). Make them from the three screen recordings with
`python -m eval.prep recordings/ --out clips/ --top 84 --bottom 56`, name them `play_08.mp4`, `play_34.mp4`, `play_43.mp4`, and copy the three `.json` files beside them
(a hand calibration is never overwritten). Run:

    cd video-service
    SCOUT_COLOR=red TRACKER=tracklets python -m eval.game clips/ --sheet eval/truth/plays_8_34_43/hudl.csv --key eval/truth/plays_8_34_43/corrected.csv --seconds 12 --out game.json --detections
    cd .. && npx jiti scripts/score-truth.ts video-service/game-work/tracks --sheet video-service/eval/truth/plays_8_34_43/hudl.csv --truth video-service/eval/truth/plays_8_34_43/truth.json

Known: play 34's calibration skews about 4 yd across the field (see CLAUDE.md, "What counts as the playing field").

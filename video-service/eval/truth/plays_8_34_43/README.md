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

## Who is who (the coach's jersey numbers) and the formation, from the coach

Jersey numbers on the red team, with the staff's letters (left to right at the snap):

- **Play 8** (and **43**, "the exact same play"): X #15, F #4, Y #81, Z #8, H #30, QB #11. In both the formation is **Bunch right, then one man (F, #4) zapped across (motion) into Deuces**, the formation it is snapped from. Hudl's tag for 8 is DUCES; its tag for 43 is TRIO, which the coach says is wrong.
- **Play 34** (Trio right): X #8, Y #4, Z #15, QB #11, H #21; the coach's list gave #81 as "z" twice, taken as F (the other man of the trips) until the coach says otherwise.

Matching a jersey to a tracker id is read off the film (`eval/label.py` pictures): on play 8 track 1 is #15 (X) and track 16 is #11 (QB); track 13 is the back (#30); the bunch men are tracks 0, 2 and 3, and #4 after the zap has no track at all.

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

## Stage 1 findings (which stage misses each route)

**Play 34** (men matched by jersey on the film: X #8 track 0, Y #4 track 2, F #81 track 18, Z #15 track 13, H #21 track 6, QB #11 track 5; replay of `rt6`, paths from the snap to +3 s): every skill man is followed as himself for 2.3-3 s (Z the whole play, jersey 15 readable at 0.1, 2.5 and 5.4 s). The reader's names on those correct paths: Y **dig** ✓, F **speed out** ✓, X speed out (truth: in / stick / hitch ✗), Z dig with post third (truth post ✗), H slide with speed out third (truth speed out ✗). Looked at point by point, the three misses are not all the reader's:
- **X:** the track has a 0.9 s hole (1.22-2.12 s after the snap) right where the stick breaks; before it he is 7 yd up, drifting out; after it the track jumps 3 yd outward in 0.4 s. A tracking miss (lost at the break, probably picked back up on the man covering him).
- **Z:** followed cleanly (no gaps, jersey 15 at 2.5 s): up about 4 yd, then angled in to about 10 yd deep near the middle by 2.7 s. The reader's top three are dig, slant, post. Whether that path is this staff's post is the coach's call.
- **H:** from 5 yd deep in the gun, straight diagonal out to the flat about 2 yd past the line and 11 yd wide. The reader says slide, then swing, with speed out third. Whether a back's speed out is that path is the coach's call.

**Play 8:** X #15 (track 1), QB #11 (track 16) and the back (track 13) are followed as themselves. The F (#4) zaps from the right bunch to the left slot and has **no track at all after the zap**, and one bunch man's track (3) slides onto a lineman in the pile by 3.5 s. Those are tracker misses (identity), not reader misses.

**Play 43:** jerseys not readable at the compressed clips' size; waiting on the coach's / Jake's matching of numbers on the full-resolution sheet.

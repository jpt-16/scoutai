# CM vs Andover (9/10/26): plays 66, 67, 96, 97

Four screen recordings of Hudl's player, 1470 x 956, 30 fps, sent 10/14. The team being scouted (CM) is on offense in
**white** jerseys; Andover's defense wears navy with gold. A night game on turf, filmed from behind Andover's bench.

Cut with `python -m eval.prep recordings/ --out clips/ --plays 66,67,96,97` (the desktop before / after full screen is dropped;
each recording also opens on about 20 frozen frames, where Hudl was paused). The clips themselves are film of minors and stay
off GitHub; `settings.json` (`{"scoutColor": "white"}`) goes in the clips zip for the Colab notebook.

| Play | Hudl's tags | Calibrated frame | Snap (about) | Ball, by the fit |
| ---- | ----------- | ---------------- | ------------ | ---------------- |
| 66 | 2 & 6, own 29, M hash, DUCES, WHEEL OUT / POST, BAL, L | 75 | 92 | own 28, far hash (18.5 yd from the far sideline) |
| 67 | 1 & 10, own 48, M hash, EMPTY, FADE / POST, R, L | 105 | 115 | own 48, far hash (18.0) |
| 96 | 1 & 10, own 40, R hash, BUNCH O, ANGLE, R, L | 44 | 56 | own 39, middle (28.9) |
| 97 | 1 & 10, opp 43, M hash, DUCES, SCREEN, BAL, L | 37 | 45 | opp 43, middle (24.0) |

The fits agree with Hudl's yard line on all four; the hash does not (Hudl says M on 66 and 67 where the ball is on the far hash, R on
96 where it is in the middle, by the midfield logo). Calibrated by hand: the field finder's own fit failed on all four (see below), so the
yard lines it found were numbered from the painted numbers, the far sideline / far hash / near hash rows named by eye, and the ball put at
the center's feet. Mean fit error 0.56-0.98 yd at the crossings used; about 2-3 yd off at the far left edge of the picture (lens bend), so
men out there read less exactly.

What this film showed:
- **Night turf is a dull green** (saturation 25-65, median 50, against ~90 on the last game's field). The paint finder's grass test
  (saturation 40-45 and up) threw out a quarter of the field, so the "grass all around it" test failed along every yard line: 2 lines found
  of a dozen. `field.GRASS_MIN_SAT` is now 20 (with `GRASS_MAX_VALUE` 200 so paint isn't grass): 8-10 lines found.
- Even then the automatic fit fails: three rows 17.78 yd apart (far sideline, far hash, near hash; the near sideline is behind the bench)
  fit equally well shifted by one, and the yard-line numbering slips. A hand anchor (which row is the far sideline, which line the "50")
  fixes both.
- **White doesn't separate as cleanly as red.** CM's offense reads 0.20-0.42 white; Andover's navy jerseys 0.00-0.13 (a few to 0.30:
  white numbers, towels, sleeves); referees that the stripe test misses 0.03-0.17. The tracker's jersey thresholds are now per color
  (`scoutteam.GATES` / `SIDES`: white 0.18 / 0.10; red keeps 0.04 / 0.01 and 0.15 / 0.06).

**First GPU run (Colab, 10/14):** every play read (60-90 s each), but only 5-8 of CM's men followed: the near-side receiver on plays 66, 96
and 97 was thrown out as "off the field". The near sideline is hidden behind Andover's bench, so nothing held that side of the fit and it
read 3 yd too wide there (the "40" numbers mapped to 47-50 yd from the far sideline, where they are 44-46). The calibrations here now also
use the **painted numbers** as two rows (tops 9 yd and bottoms 7 yd in from the near sideline: 44.33 and 46.33), which brings that side in
(play 96's near receiver: 53 yd, off the field, to 48.8). Replayed from the run's saved detections with `python -m eval.label <dump> <clip>
--start <frame> --scout-color white --calibration play_NN.json --tracks tracks/`: 6-9 of the offense followed per play (most of the rest
are linemen in the pile). Cards built from those tracks still show paths that look wrong (play 66's H running backward, 67's F and Z along
the line), so the coach's routes decide what's a tracking slip.

**Needed from the coach** (per play): what X, F, Y, Z and H ran (left to right from the offense's view, H the back), and jersey numbers if
two are easy to mix up. Then `truth.json` here gets them and `scripts/score-truth.ts` scores the Colab run.

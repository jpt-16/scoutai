"""Calibrates a clip with no clicking: finds the snap, the field, the ball and which way the
offense is going.

    python -m eval.autocalib clips/            # every clip without a .json beside it
    python -m eval.autocalib clips/ --force    # redo them all

It writes the same `<clip>.json` that `eval.calibrate` does, so `eval.presnap` and
`eval.tracks` don't know the difference. A clip it can't do (no usable paint, rows that could
be any pair of the four, groups of players that don't separate) is listed with the reason and
left for `python -m eval.calibrate`, instead of being given a confident wrong answer. For each
clip that works it also saves `debug/<clip>_auto.jpg`: the yard lines it believes in drawn back
over the frame, with the ball, so one look says whether to trust it.

 1. **The snap** (`find_snap`): the picture is nearly still while the offense sets, then eleven
    people start moving at once. The frame before the biggest jump in motion is the snap.
 2. **The field** (`eval.field.calibrate_field`): yard lines and rows to a pixel -> yards matrix.
 3. **The ball and the direction** (`locate_scene`): people are put on the field, split into
    two teams by jersey color, and the line of scrimmage is where the two groups meet. The
    offense is the group that stays close to it (linemen and a couple of backs); the defense
    is spread deeper (linebackers and safeties). The offense is behind the ball, so the
    direction follows, and the ball's across-the-field spot is the middle of the offensive line.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .field import HASH_IN, FieldFailure, FieldFit, calibrate_field
from .teams import two_means

# People further than this (yards) from the rest of the crowd's middle are fans and sideline staff.
CROWD_YARDS = 25.0
# A player stands at least this far inside a sideline (yards); see presnap.EDGE_YARDS.
EDGE_YARDS = 3.0
FIELD_WIDTH = 160 / 3
MIN_PER_TEAM = 5
# The ball is a bit past the offense's front feet.
BALL_PAST_FEET = 0.3
# Groups whose fronts overlap by more than this (yards) did not separate: not a snap-ready look.
MAX_OVERLAP = 1.5


@dataclass
class Scene:
    ball: tuple[float, float]  # field yards
    direction: int  # +1: the offense is going toward +y in the field frame
    offense_label: int
    margin: float  # how much closer the offense is to the ball than the defense (ratio, > 1)
    offense: int
    defense: int


@dataclass
class SceneFailure:
    reason: str


def find_snap(grays: list[np.ndarray], fps: float) -> int:
    """The frame before the biggest sustained jump in motion."""
    n = len(grays)
    if n < 6:
        return 0
    motion = np.array([0.0] + [float(np.mean(cv2.absdiff(grays[i], grays[i - 1]))) for i in range(1, n)])
    w = max(2, int(0.5 * fps))
    best, at = -np.inf, 0
    for t in range(w, n - w + 1):
        rise = motion[t : t + w].mean() - motion[t - w : t].mean()
        if rise > best:
            best, at = rise, t
    return max(0, at - 1)


def locate_scene(points: list[tuple[float, float]], labels: list[int]) -> Scene | SceneFailure:
    """Ball and direction from where everyone stands (field yards) and which team each is on."""
    if len(points) < 2 * MIN_PER_TEAM:
        return SceneFailure("too_few_people")
    pts = np.array(points, float)
    center = np.median(pts, axis=0)
    keep = [
        i
        for i, (x, y) in enumerate(points)
        if abs(y - center[1]) <= CROWD_YARDS and EDGE_YARDS <= x <= FIELD_WIDTH - EDGE_YARDS
    ]
    ys = {k: [points[i][1] for i in keep if labels[i] == k] for k in (0, 1)}
    if min(len(ys[0]), len(ys[1])) < MIN_PER_TEAM:
        return SceneFailure("teams_did_not_separate")
    low, high = (0, 1) if np.mean(ys[0]) <= np.mean(ys[1]) else (1, 0)
    front_low = float(np.mean(sorted(ys[low])[-3:]))
    front_high = float(np.mean(sorted(ys[high])[:3]))
    if front_low > front_high + MAX_OVERLAP:
        return SceneFailure("groups_overlap")
    los = (front_low + front_high) / 2
    spread = {k: float(np.mean(np.abs(np.array(ys[k]) - los))) for k in (0, 1)}
    offense = min(spread, key=spread.get)
    defense = 1 - offense
    margin = spread[defense] / max(spread[offense], 0.1)
    if margin < 1.15:
        return SceneFailure("cannot_tell_offense")
    direction = 1 if offense == low else -1
    front = front_low if offense == low else front_high
    ball_y = front + direction * BALL_PAST_FEET
    # The center is in the middle of the men on the line: the five nearest the middle of those
    # on it, so wide receivers (who are on the line too) don't pull the ball sideways.
    on_line = [points[i] for i in keep if labels[i] == offense and abs(points[i][1] - ball_y) <= 1.0]
    if len(on_line) < 3:
        return SceneFailure("no_line_found")
    middle = float(np.median([p[0] for p in on_line]))
    line = sorted(on_line, key=lambda p: abs(p[0] - middle))[:5]
    ball_x = float(np.median([p[0] for p in line]))
    return Scene((ball_x, ball_y), direction, offense, margin, len(ys[offense]), len(ys[defense]))


def draw_debug(frame: np.ndarray, to_field: np.ndarray, ball: tuple[float, float], text: str) -> np.ndarray:
    """The field the program believes in, over the picture: 5-yard lines, the hash rows, the ball."""
    to_pixel = np.linalg.inv(to_field)
    out = frame.copy()

    def px(x: float, y: float) -> tuple[int, int]:
        p = cv2.perspectiveTransform(np.float32([[[x, y]]]), to_pixel)[0, 0]
        return int(p[0]), int(p[1])

    start = 5 * round((ball[1] - 30) / 5)
    for y in range(int(start), int(start) + 65, 5):
        cv2.line(out, px(0, y), px(FIELD_WIDTH, y), (0, 255, 255), 2)
    for x in (0, HASH_IN, FIELD_WIDTH - HASH_IN, FIELD_WIDTH):
        cv2.line(out, px(x, ball[1] - 30), px(x, ball[1] + 30), (255, 200, 0), 2)
    cv2.circle(out, px(*ball), 10, (0, 0, 255), -1)
    cv2.putText(out, text, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
    return out


def auto_calibrate(path: Path, detector, tiles: int = 2, debug_dir: Path | None = None) -> dict | FieldFailure | SceneFailure:
    """The calibration for one clip as `eval.calibrate` writes it, or the reason it can't."""
    from .presnap import torso_color

    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames_small: list[np.ndarray] = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        small = cv2.resize(frame, (160, 90), interpolation=cv2.INTER_AREA)
        frames_small.append(cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (5, 5), 0))
    if len(frames_small) < 3:
        return FieldFailure("unreadable", {"frames": len(frames_small)})
    snap = find_snap(frames_small, fps)

    def frame_at(i: int):
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, f = cap.read()
        return f if ok else None

    # The paint is the same in the frames just before the snap; take the best fit of a few.
    best: FieldFit | None = None
    failure: FieldFailure | None = None
    for i in sorted({snap, max(0, snap - 4), max(0, snap - 8)}):
        f = frame_at(i)
        if f is None:
            continue
        fit = calibrate_field(f)
        if isinstance(fit, FieldFit):
            if best is None or fit.residual < best.residual:
                best = fit
        else:
            failure = failure or fit
    if best is None:
        return failure or FieldFailure("no_frame")
    snap_frame = frame_at(snap)

    boxes = detector.people(snap_frame, tiles)
    feet = np.float32([[[(b[0] + b[2]) / 2, b[3]]] for b in boxes]).reshape(1, -1, 2) if boxes else None
    if feet is None:
        return SceneFailure("no_people")
    on_field = cv2.perspectiveTransform(feet, best.to_field)[0]
    labels = two_means([torso_color(snap_frame, b) for b in boxes])
    scene = locate_scene([(float(x), float(y)) for x, y in on_field], labels)
    if isinstance(scene, SceneFailure):
        return scene

    bx, by = scene.ball
    corners = [(bx - 14, by - 10), (bx + 14, by - 10), (bx - 14, by + 10), (bx + 14, by + 10)]
    to_pixel = np.linalg.inv(best.to_field)
    source = cv2.perspectiveTransform(np.float32([corners]), to_pixel)[0]
    ball_px = cv2.perspectiveTransform(np.float32([[[bx, by]]]), to_pixel)[0, 0]
    if debug_dir:
        debug_dir.mkdir(parents=True, exist_ok=True)
        label = f"{scene.offense} off / {scene.defense} def, residual {best.residual:.2f} yd, {best.lines} lines {best.rows} rows"
        cv2.imwrite(str(debug_dir / f"{path.stem}_auto.jpg"), draw_debug(snap_frame, best.to_field, scene.ball, label))
    return {
        "frame": snap,
        "source": [[float(x), float(y)] for x, y in source],
        "destination": [[float(x), float(y)] for x, y in corners],
        "ball": [float(ball_px[0]), float(ball_px[1])],
        "direction": scene.direction,
        "auto": {
            "residual": round(best.residual, 3),
            "lines": best.lines,
            "rows": best.rows,
            "offense": scene.offense,
            "defense": scene.defense,
            "margin": round(scene.margin, 2),
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("clips", type=Path)
    ap.add_argument("--force", action="store_true", help="redo clips that already have a .json")
    ap.add_argument("--tiles", type=int, default=2)
    ap.add_argument("--debug", type=Path, default=Path("debug"))
    args = ap.parse_args()

    from .presnap import Detector

    detector = Detector()
    clips = sorted(p for p in args.clips.iterdir() if p.suffix.lower() in {".mp4", ".mov", ".m4v"})
    failed: list[tuple[str, str]] = []
    done = 0
    for clip in clips:
        out = clip.with_suffix(".json")
        if out.exists() and not args.force:
            continue
        result = auto_calibrate(clip, detector, args.tiles, args.debug)
        if isinstance(result, (FieldFailure, SceneFailure)):
            failed.append((clip.name, result.reason))
            print(f"{clip.name}: needs a hand ({result.reason})")
            continue
        out.write_text(json.dumps(result, indent=2))
        done += 1
        print(f"{clip.name}: snap at frame {result['frame']}, {result['auto']['offense']} offense, residual {result['auto']['residual']} yd")
    print(f"\n{done} calibrated, {len(failed)} left for `python -m eval.calibrate`")
    for name, reason in failed:
        print(f"  {name}: {reason}")


if __name__ == "__main__":
    main()

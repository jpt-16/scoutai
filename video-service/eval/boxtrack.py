"""Following everyone by their boxes in the camera-held picture, the way a man's own box overlaps itself from frame to frame.

    python -m eval.tracks clips/ --out tracks/ --region --tracker boxes      (the default)

The first tracker (`tracks.follow`) pairs people by where they stand on the field, in yards. A man's spot comes from his
feet (the bottom of his box) put through the field's homography, and on the far side of the field a box bottom a few pixels
off moves him a yard and a half across it: measured on the three real plays (8, 34, 43), a far receiver's spot jumped 1.5-2.5 yd
from frame to frame while his box barely moved. So a track either lost him (a tight step) or, given room, jumped onto the man
beside him (a loose one), and no setting did both: the hand-marked receivers (`truth/plays_8_34_43/play_*_men.json`) went from 43 of 81
marks with the yards tracker to between 49 and 74 depending on one number.

Here each box is warped onto the snap frame through the camera's own motion (`to_snap`, so a pan or zoom doesn't move anyone) and
a man is continued by the box that overlaps where his box was heading (intersection over union, `MIN_IOU`). Box overlap is a few
pixels of error everywhere in the picture, near side or far, so one setting holds: with `MIN_IOU` 0.25, 78 of the 81 marks right,
**none wrong** and 3 missed for every `GAP_SLACK` from 0.15 to 0.25 and `GAP_GROWTH` from 0 to 0.15 (69-79 across a wider grid), and
zoomed crops of every receiver and back of the three plays show his own jersey along his track. The three misses are play 43's
slot (#81) after the mesh, where the detector stops finding him, and its zapped F, lost in the pile at the snap.

Two more rules:
 * **Jerseys of the scouted team.** Given the share of each box's torso in the scouted team's color (`scoutteam.color_share`;
   real film: the red offense 0.07-0.68, the gold defense 0.00), a track that has worn it never takes a box that doesn't
   (`NOT_WEARS`), and one that hasn't never takes a box that does (`WEARS`). Without a color, no gate.
 * **After a gap** (the detector missed him), his box may have moved off where it was heading: a box whose bottom centre is within
   `GAP_SLACK` of a box height of it (a little more for each frame missed) may continue him, weaker than any real overlap.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

# A box overlapping where his box was heading by at least this much (intersection over union) is him.
MIN_IOU = 0.25
# After missed frames: a box whose bottom centre is within this many box heights of where his was heading may be him, growing by
# `GAP_GROWTH` of that for each frame missed.
GAP_SLACK = 0.2
GAP_GROWTH = 0.1
# A track missing for this many frames is dropped (as `tracks.MAX_MISSED`).
MAX_MISSED = 45
# His box's speed is read over this many of his last matches, once he has `VELOCITY_MIN_POINTS`, and projected at most `MAX_AHEAD` frames.
VELOCITY_FRAMES = 6
VELOCITY_MIN_POINTS = 4
MAX_AHEAD = 10
# A man's spot in yards still jumps with his box's bottom edge (1.5-2.5 yd a frame on the far side), so once the boxes have said who
# is who, each track's spots are smoothed: a running median over `SMOOTH_MEDIAN` of his points, then a running mean over `SMOOTH_MEAN`.
# Unsmoothed, the card builder's jump check (`trackedPlay.trimAtJump`) cut the far receivers' tracks at the first spike and the reader
# saw jagged paths: 2 of the 15 routes the coach named on plays 8, 34 and 43 read right; smoothed, 8 to 9 (a median of 5-9 and a mean of 5-9 alike).
SMOOTH_MEDIAN = 7
SMOOTH_MEAN = 5
# Where his feet are: a box's bottom edge jitters (legs, blur, the grass under him), its middle much less, and a man's height changes
# slowly. So, with the field known (`locate`), his feet are put at the middle of his box plus half his height as it has run over the
# `STEADY_HEIGHT_FRAMES` either side (a median, so a box cut short behind another man for a few frames doesn't pull it). On plays 8, 34 and
# 43 that took the frame-to-frame roughness of the receivers' and backs' paths down 35-40% (0.60-0.84 to 0.40-0.55 yd a frame squared).
STEADY_HEIGHT_FRAMES = 15
# The share of a torso in the scouted team's color that says he wears it, and the share under which he doesn't.
WEARS = 0.04
NOT_WEARS = 0.01

Box4 = tuple[float, float, float, float]


def warp_boxes(boxes, to_snap: np.ndarray) -> list[Box4]:
    """Each box's corners put on the snap frame through the camera's motion since it, as a box again."""
    out = []
    for b in boxes:
        pts = cv2.perspectiveTransform(np.float32([[[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]]]), np.asarray(to_snap, dtype=np.float64))[0]
        out.append((float(pts[:, 0].min()), float(pts[:, 1].min()), float(pts[:, 0].max()), float(pts[:, 1].max())))
    return out


def iou(a: Box4, b: Box4) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter + 1e-9)


@dataclass
class BoxTrack:
    """The same shape `tracks.Track` has (`id`, `start`, `points`, `matched`), so `track_play` writes it the same way."""

    id: int
    start: tuple[float, float]
    points: list[tuple[int, float, float]]
    matched: list[tuple[int, int]]
    boxes: list[tuple[int, Box4]] = field(default_factory=list)
    worn: list[float] = field(default_factory=list)
    missed: int = 0

    def wears(self) -> int:
        """+1 if he wears the scouted team's color, -1 if he doesn't, 0 if it can't be told (or no color was given)."""
        if not self.worn:
            return 0
        m = float(np.median(self.worn))
        return 1 if m >= WEARS else -1 if m < NOT_WEARS else 0

    def heading(self, f: int) -> Box4:
        """Where his box would be at frame `f` if it kept moving the way it was (held still until it has moved for a few frames)."""
        fl, bl = self.boxes[-1]
        if len(self.boxes) < VELOCITY_MIN_POINTS:
            return bl
        f0, b0 = self.boxes[-1 - min(VELOCITY_FRAMES, len(self.boxes) - 1)]
        dt = max(1, fl - f0)
        vx = ((bl[0] + bl[2]) - (b0[0] + b0[2])) / 2 / dt
        vy = (bl[3] - b0[3]) / dt
        ahead = min(f - fl, MAX_AHEAD)
        return (bl[0] + vx * ahead, bl[1] + vy * ahead, bl[2] + vx * ahead, bl[3] + vy * ahead)


def _refused(track: BoxTrack, share: float | None) -> bool:
    if share is None:
        return False
    side = track.wears()
    return (side > 0 and share < NOT_WEARS) or (side < 0 and share >= WEARS)


def follow_boxes(
    boxes: list[list[Box4]],
    per_frame: list[list[tuple[float, float]]],
    shares: list[list[float]] | None = None,
    locate=None,
) -> list[BoxTrack]:
    """`boxes[f][j]` is person j of frame f warped onto the snap frame (`warp_boxes`), `per_frame[f][j]` his spot in yards (what the
    track records), `shares[f][j]` the share of his torso in the scouted team's color (or None). Everyone in frame 0 is followed.
    `locate(x, y)`: a pixel of the snap frame to yards (offense's view); given, each spot is redone from his box's middle and his
    steady height (`steady_feet`)."""
    tracks = [
        BoxTrack(j, per_frame[0][j], [(0, *per_frame[0][j])], [(0, j)], [(0, boxes[0][j])], [shares[0][j]] if shares else [])
        for j in range(len(per_frame[0]))
    ]
    for f in range(1, len(per_frame)):
        free = set(range(len(per_frame[f])))
        pairs = []
        for ti, t in enumerate(tracks):
            if t.missed > MAX_MISSED:
                continue
            head = t.heading(f)
            height = max(head[3] - head[1], 1.0)
            for j in free:
                if _refused(t, shares[f][j] if shares else None):
                    continue
                b = boxes[f][j]
                overlap = iou(head, b)
                if overlap < MIN_IOU:
                    if t.missed == 0:
                        continue
                    # Missed for a while: near where his feet were heading, weaker than any real overlap.
                    off = float(np.hypot((head[0] + head[2] - b[0] - b[2]) / 2, head[3] - b[3])) / height
                    if off > GAP_SLACK * (1 + GAP_GROWTH * t.missed):
                        continue
                    overlap = MIN_IOU * (1 - off)
                pairs.append((-overlap, ti, j))
        pairs.sort()
        taken: set[int] = set()
        for _, ti, j in pairs:
            if ti in taken or j not in free:
                continue
            t = tracks[ti]
            t.points.append((f, *per_frame[f][j]))
            t.matched.append((f, j))
            t.boxes.append((f, boxes[f][j]))
            if shares:
                t.worn.append(shares[f][j])
            t.missed = 0
            taken.add(ti)
            free.discard(j)
        for ti, t in enumerate(tracks):
            if ti not in taken:
                t.missed += 1
    for t in tracks:
        if locate is not None:
            t.points = steady_feet(t, locate)
        t.points = smoothed(t.points)
    return tracks


def steady_feet(track: BoxTrack, locate) -> list[tuple[int, float, float]]:
    """His spots from the middle of each box and his height as it has run (see `STEADY_HEIGHT_FRAMES`), not the box's bottom edge."""
    heights = [b[3] - b[1] for _, b in track.boxes]
    out = []
    for i, (f, b) in enumerate(track.boxes):
        h = float(np.median(heights[max(0, i - STEADY_HEIGHT_FRAMES) : i + STEADY_HEIGHT_FRAMES + 1]))
        x, y = locate((b[0] + b[2]) / 2, (b[1] + b[3]) / 2 + h / 2)
        out.append((f, float(x), float(y)))
    return out


def _running(values: list[float], width: int, fn) -> list[float]:
    half = width // 2
    return [float(fn(values[max(0, i - half) : i + half + 1])) for i in range(len(values))]


def smoothed(points: list[tuple[int, float, float]]) -> list[tuple[int, float, float]]:
    """His spots with the box-edge jitter taken out (`SMOOTH_MEDIAN`, then `SMOOTH_MEAN`), at the same frames."""
    if len(points) < 3:
        return points
    xs = _running(_running([p[1] for p in points], SMOOTH_MEDIAN, np.median), SMOOTH_MEAN, np.mean)
    ys = _running(_running([p[2] for p in points], SMOOTH_MEDIAN, np.median), SMOOTH_MEAN, np.mean)
    return [(f, x, y) for (f, _, _), x, y in zip(points, xs, ys)]

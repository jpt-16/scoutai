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
# `GAP_GROWTH` of that for each frame missed. A far receiver at night is missed for 4-24 frames at a time (CM vs Andover) and runs
# 2-4 yards in that time; with 0.1 a frame his track was dropped before he was found again. Scored on all seven hand-marked plays
# (8, 34, 43, 66, 67, 96, 97): 140 of 156 marks at 0.1, 144-147 from 0.45 to 0.75 (with `MAX_AHEAD` 20), 136-138 at 1.0 (a lost
# track reaches the man beside him); 0.6 sits in the middle of that plateau, and plays 8/34/43 lose nothing.
GAP_SLACK = 0.2
GAP_GROWTH = 0.6
# ...but never more than this many box heights: unbounded, a track missing for a second reached half the picture on a near-side box and
# leapt 30-40 yards (play 97's sideline coach onto a back, play 66 across the field). At 3 the seven plays keep 150 of 156 marks and
# offense tracks with a leap faster than 24 yd/s go from 6 to 3 (1 to 2 heights: 147-148 marks, 2 leaps).
GAP_MAX_HEIGHTS = 3.0
# ...and on the field, no further from where he was last seen than a man can run in the time (a box height is about 2 yards along the
# field but many more across it, up and down the picture: play 66's near receiver's track jumped 19 yards across within the height cap):
# `GAP_YARDS` for a far box's jitter, plus `GAP_YARDS_PER_FRAME` (0.35: 10.5 yd/s) for every frame since.
GAP_YARDS = 2.5
GAP_YARDS_PER_FRAME = 0.35
# A track missing for this many frames is dropped (as `tracks.MAX_MISSED`).
MAX_MISSED = 45
# His box's speed is read over this many of his last matches, once he has `VELOCITY_MIN_POINTS`, and projected at most `MAX_AHEAD` frames.
VELOCITY_FRAMES = 6
VELOCITY_MIN_POINTS = 4
MAX_AHEAD = 20
# His box's usual width and height: the median over his last this many boxes.
SIZE_FRAMES = 8
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
# Seeding after the first frame. Everyone in frame 0 is followed, but a far receiver the detector misses on that one frame (CM vs
# Andover, a night game: the far side's men were found in about half the frames) was never followed at all: play 66's far receivers ran
# a post and a comeback in the raw detections and no track held either. So, until `SEED_FRAMES` (the set and the snap: the clip starts a
# second or so before it), a man in the scouted team's color whom no track continues and no track of his own team stands near
# (`SEED_CLEAR_YARDS`; a pressed corner a yard off him doesn't count) starts
# his own track. Only that color: seeding everyone late was tried before and added the crowd, the bench and the referees. A late track
# that holds under `SEED_MIN_POINTS` matches was a flicker and is dropped.
SEED_FRAMES = 45
SEED_CLEAR_YARDS = 2.0
SEED_MIN_POINTS = 15
# ...and only on his team's side of the ball (the side most of frame 0's wearers stand on), within this much past the line: on play 43 a
# red figure 9 yards downfield before the snap started a track that took the slot's boxes when he ran by.
SEED_PAST_LINE_YARDS = 2.0
SIDE_MIN_GAP = 0.05  # how much more of the color one side has to wear to be called the scouted team's
# ...and only outside the box: a late track among the linemen (packed a yard apart) only competes with the men already followed there,
# and took play 43's slot when he crossed the formation. The late seeds that matter are split receivers.
SEED_MIN_SPLIT_YARDS = 4.5
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
    # (frame, person) he was first seen as, when that was after frame 0 (`SEED_FRAMES`); None for the people of frame 0.
    seeded: tuple[int, int] | None = None
    # The letter a coach tapped him as (`taps.py`): X, F, Y, Z, H or Q. `shared`: other letters tapped on the same man (a stack the
    # detector sees as one box), which this track can only follow once.
    label: str | None = None
    shared: list[str] = field(default_factory=list)

    def wears(self, gate: tuple[float, float] = (WEARS, NOT_WEARS)) -> int:
        """+1 if he wears the scouted team's color, -1 if he doesn't, 0 if it can't be told (or no color was given)."""
        if self.label:
            return 1  # a coach tapped him: he is the scouted team's, whatever a blurred first few boxes read
        if not self.worn:
            return 0
        m = float(np.median(self.worn))
        return 1 if m >= gate[0] else -1 if m < gate[1] else 0

    def heading(self, f: int) -> Box4:
        """Where his box would be at frame `f` if it kept moving the way it was (held still until it has moved for a few frames): its
        middle carried on at its speed, at the size his boxes have usually been. Read from the middle and the usual size, not the last
        box's edges, because a box cut short for a frame (legs hidden behind another man) moves its bottom edge half a man's height: on
        real play 43 that read as a leap upward, the prediction drifted off the slot (#81) and his track was dropped while the detector
        kept finding him."""
        fl, bl = self.boxes[-1]
        recent = [b for _, b in self.boxes[-SIZE_FRAMES:]]
        w = float(np.median([b[2] - b[0] for b in recent]))
        h = float(np.median([b[3] - b[1] for b in recent]))
        cx, cy = (bl[0] + bl[2]) / 2, (bl[1] + bl[3]) / 2
        if len(self.boxes) >= VELOCITY_MIN_POINTS:
            f0, b0 = self.boxes[-1 - min(VELOCITY_FRAMES, len(self.boxes) - 1)]
            dt = max(1, fl - f0)
            ahead = min(f - fl, MAX_AHEAD)
            cx += ((bl[0] + bl[2]) - (b0[0] + b0[2])) / 2 / dt * ahead
            cy += ((bl[1] + bl[3]) - (b0[1] + b0[3])) / 2 / dt * ahead
        return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def _refused(track: BoxTrack, share: float | None, gate: tuple[float, float] = (WEARS, NOT_WEARS)) -> bool:
    if share is None:
        return False
    side = track.wears(gate)
    return (side > 0 and share < gate[1]) or (side < 0 and share >= gate[0])


def follow_boxes(
    boxes: list[list[Box4]],
    per_frame: list[list[tuple[float, float]]],
    shares: list[list[float]] | None = None,
    locate=None,
    gate: tuple[float, float] = (WEARS, NOT_WEARS),
    seed_frames: int | None = None,
    forced: list[tuple[int, int, str]] | None = None,
) -> list[BoxTrack]:
    """`boxes[f][j]` is person j of frame f warped onto the snap frame (`warp_boxes`), `per_frame[f][j]` his spot in yards (what the
    track records), `shares[f][j]` the share of his torso in the scouted team's color (or None). Everyone in frame 0 is followed, and anyone in the scouted team's
    color who turns up unfollowed by `seed_frames` (`SEED_FRAMES`; a track's `seeded` says where).
    `forced`: `(frame, person, letter)` a coach tapped (`taps.resolve`): that man gets a track with his letter (the one that already
    follows him is named, else one is started there, whatever his jersey says), and it stays however short it turns out.
    `locate(x, y)`: a pixel of the snap frame to yards (offense's view); given, each spot is redone from his box's middle and his
    steady height (`steady_feet`). `gate`: (wears, doesn't) for the scouted team's color (`scoutteam.wear_gate`)."""
    seed_until = SEED_FRAMES if seed_frames is None else seed_frames
    forced_at: dict[int, list[tuple[int, str]]] = {}
    for ff, jj, letter in forced or []:
        forced_at.setdefault(ff, []).append((jj, letter))
    tracks = [
        BoxTrack(j, per_frame[0][j], [(0, *per_frame[0][j])], [(0, j)], [(0, boxes[0][j])], [shares[0][j]] if shares else [])
        for j in range(len(per_frame[0]))
    ]
    for jj, letter in forced_at.get(0, []):
        _name(tracks[jj], letter)
    # Which side of the ball the scouted team is on: +1 behind it (offense), -1 past it, 0 can't tell (then nobody is seeded late). The
    # group that wears more of the color, the men behind the ball or the men past it (counting only those who stand where the two
    # teams line up); the middle of the wearers alone came out backwards on play 66, where the sideline past the line wore white too.
    near = [(y, share) for (x, y), share in zip(per_frame[0], shares[0] if shares else []) if share is not None and abs(y) <= 12 and abs(x) <= 25]
    behind = [share for y, share in near if y < -0.5]
    past = [share for y, share in near if y > 0.5]
    their_side = 0
    if len(behind) >= 3 and len(past) >= 3:
        gap = float(np.mean(behind)) - float(np.mean(past))
        their_side = 1 if gap > SIDE_MIN_GAP else -1 if gap < -SIDE_MIN_GAP else 0
    for f in range(1, len(per_frame)):
        free = set(range(len(per_frame[f])))
        pairs = []
        for ti, t in enumerate(tracks):
            if t.missed > MAX_MISSED:
                continue
            head = t.heading(f)
            height = max(head[3] - head[1], 1.0)
            for j in free:
                if _refused(t, shares[f][j] if shares else None, gate):
                    continue
                b = boxes[f][j]
                overlap = iou(head, b)
                if overlap < MIN_IOU:
                    if t.missed == 0:
                        continue
                    # Missed for a while: near where his feet were heading, weaker than any real overlap.
                    off = float(np.hypot((head[0] + head[2] - b[0] - b[2]) / 2, head[3] - b[3])) / height
                    if off > min(GAP_SLACK * (1 + GAP_GROWTH * t.missed), GAP_MAX_HEIGHTS):
                        continue
                    overlap = MIN_IOU * (1 - off)
                if t.missed:
                    lf, lx, ly = t.points[-1]
                    px, py = per_frame[f][j]
                    if np.hypot(px - lx, py - ly) > GAP_YARDS + GAP_YARDS_PER_FRAME * (f - lf):
                        continue
                pairs.append((-overlap, ti, j))
        pairs.sort()
        taken: set[int] = set()
        taker: dict[int, int] = {}
        for _, ti, j in pairs:
            if ti in taken or j not in free:
                continue
            taker[j] = ti
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
        for jj, letter in forced_at.get(f, []):
            if jj in taker:
                _name(tracks[taker[jj]], letter)
            elif jj in free and (heir := _lost_track_near(tracks, f, per_frame[f][jj], shares[f][jj] if shares else None, gate)) is not None:
                # He is the man a track lost a moment ago: the tap continues that track (his whole play on one track), not a second one.
                heir.points.append((f, *per_frame[f][jj]))
                heir.matched.append((f, jj))
                heir.boxes.append((f, boxes[f][jj]))
                if shares and shares[f][jj] is not None:
                    heir.worn.append(shares[f][jj])
                heir.missed = 0
                heir.label = letter
                free.discard(jj)
            elif jj in free:
                tracks.append(
                    BoxTrack(
                        len(tracks), per_frame[f][jj], [(f, *per_frame[f][jj])], [(f, jj)], [(f, boxes[f][jj])],
                        [shares[f][jj]] if shares and shares[f][jj] is not None else [], seeded=(f, jj), label=letter,
                    )
                )
                free.discard(jj)
        if shares and their_side and f <= seed_until:
            for j in sorted(free):
                if shares[f][j] is None or shares[f][j] < gate[0]:
                    continue
                x, y = per_frame[f][j]
                if y * their_side > SEED_PAST_LINE_YARDS or abs(x) < SEED_MIN_SPLIT_YARDS:
                    continue
                # Already followed only by a track that could be him: a corner pressed on a receiver stands within a yard of him.
                if any(
                    t.missed <= MAX_MISSED
                    and not _refused(t, shares[f][j], gate)
                    and np.hypot(t.points[-1][1] - x, t.points[-1][2] - y) <= SEED_CLEAR_YARDS
                    for t in tracks
                ):
                    continue
                tracks.append(BoxTrack(len(tracks), (x, y), [(f, x, y)], [(f, j)], [(f, boxes[f][j])], [shares[f][j]], seeded=(f, j)))
    tracks = [t for t in tracks if t.label or t.seeded is None or len(t.matched) >= SEED_MIN_POINTS]
    for t in tracks:
        if locate is not None:
            t.points = steady_feet(t, locate)
        t.points = smoothed(t.points)
    return tracks


def _lost_track_near(tracks: list[BoxTrack], f: int, spot: tuple[float, float], share: float | None, gate) -> BoxTrack | None:
    """The unnamed track that lost its man within the last `MAX_MISSED` frames and could have run to `spot` since (the same yards rule as
    after any miss), the nearest if several."""
    best = None
    for t in tracks:
        if t.label or not t.missed or t.missed > MAX_MISSED:
            continue  # (no jersey check: the coach said this man is his, and a far blurred man's first boxes can read as a dark jersey)
        lf, lx, ly = t.points[-1]
        d = float(np.hypot(spot[0] - lx, spot[1] - ly))
        if d <= GAP_YARDS + GAP_YARDS_PER_FRAME * (f - lf) and (best is None or d < best[0]):
            best = (d, t)
    return best[1] if best else None


def _name(track: BoxTrack, letter: str) -> None:
    """A coach's tap names this track; a second tap on the same man (a stack seen as one box) is kept in `shared`."""
    if track.label is None or track.label == letter:
        track.label = letter
    elif letter not in track.shared:
        track.shared.append(letter)


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

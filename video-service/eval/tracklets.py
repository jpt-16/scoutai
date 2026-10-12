"""Following everyone by short clean pieces and joining them up, with the two teams kept apart by their jerseys.

    python -m eval.tracks clips/ --out tracks/ --region --tracker tracklets

The first tracker (`tracks.follow`) carries each man from frame to frame and lets a lost man be picked up again by
whoever turns up near where he was heading. On real film (four Hudl recordings from behind a bench) its tracks were
handed to the covering defender, to a referee and to the bench, and a lost receiver was rarely found again: on play 5,
5 of 13 hand-marked receiver positions were on the right man's track. This one works in two steps:

 1. **Tracklets.** Frame to frame, a man is only continued by someone close to where he was heading, for at most a
    few missed frames, and never by a man in the other team's jersey (`team_score`, below). Anyone left over starts a
    new tracklet. The pieces are short but clean: where the detector loses a man or two men cross, the piece ends
    instead of jumping to the wrong one.
 2. **Stitching.** Each man seen at the snap (or in the half second after it, if the detector missed him on the snap
    frame) is followed through the play by joining, end to start, the later piece he could have run to (from where he
    was heading, with a hard start or stop allowed, and never faster than a sprint), in the same jersey, cheapest first.
    Pieces that never join a man seen at the snap (the bench, the crowd, an official) are dropped.

Teams by jersey: the torso of every box is reduced to a signature (`jersey_signature`: how much of it is each of four
greys from dark to white, and each of six hues), the snap frame's offense and defense (by which side of the ball they
stand on) give each team's typical signature, and every later box is scored between the two. Learned per play, so it
works for any two uniforms. On the real film it put the offense at +0.3 to +0.8 and the defense at -0.1 to -0.6.

Measured on play 5 of the real recordings (`video-service/eval/truth.py`'s marks): 8 of 13 receiver positions on
the right track against 5 of 13 for `tracks.follow`, and on play 6 all four receivers followed against three. The
route names on those two plays did not get better yet (the far slot is still lost in the first half second, beside
the outside receiver), so this is a choice, not the default, until it has been run on more film.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

# --- Teams by jersey ---------------------------------------------------------------------------------------------
# A man whose jersey reads this far toward the other team is never his.
TEAM_MARGIN = 0.15

# --- Tracklets ---------------------------------------------------------------------------------------------------
STEP_YARDS = 0.9  # from where he was heading, seen last frame
GROWTH_YARDS = 0.3  # more for each frame he was missed
TRACKLET_MISSED = 6  # a piece ends after this many frames with no one where he should be
APPEARANCE_YARDS = 3.0  # cost: yards per unit of jersey difference
SIGNATURE_MEMORY = 0.9
VELOCITY_FRAMES = 6
VELOCITY_MIN_POINTS = 4
MAX_YARDS_PER_FRAME = 0.45

# --- Stitching ---------------------------------------------------------------------------------------------------
STITCH_MAX_GAP = 45  # frames
STITCH_BASE_YARDS = 2.0  # box error allowed at any gap (one far box's jitter is a yard)
STITCH_ACCEL = 6.0  # yd/s/s: how far from where he was heading a hard start or stop can take him
STITCH_TOP_SPEED = 0.34  # yd a frame (10 yd/s): how far from where he was last seen he can be
STITCH_APPEARANCE = 0.45  # Hellinger: jerseys more different than this are not the same man
MIN_TRACKLET = 2
ROOT_FRAMES = 15  # a man the detector missed on the snap frame can still be followed from his first half second
ROOT_MIN_POINTS = 5
ROOT_CLEAR_YARDS = 1.5  # ...if he isn't someone already followed from the snap frame


def jersey_signature(frame_bgr: np.ndarray, box) -> np.ndarray:
    """What his jersey looks like, as fractions of the torso: four greys (dark to white) and six hues."""
    x0, y0, x1, y1 = (int(v) for v in box[:4])
    h, w = y1 - y0, x1 - x0
    torso = frame_bgr[max(0, y0 + int(0.18 * h)) : max(0, y0 + int(0.5 * h)), max(0, x0 + int(0.22 * w)) : max(0, x0 + int(0.78 * w))]
    out = np.zeros(10, np.float32)
    if torso.size == 0:
        return out
    hsv = cv2.cvtColor(torso, cv2.COLOR_BGR2HSV).reshape(-1, 3).astype(np.float32)
    hue, sat, val = hsv[:, 0], hsv[:, 1], hsv[:, 2]
    grey = (sat < 60) | (val < 60)
    out[:4] = np.bincount(np.digitize(val[grey], [70, 120, 165]), minlength=4)[:4]
    out[4:] = np.bincount(np.minimum((hue[~grey] / 30).astype(int), 5), minlength=6)[:6]
    return out / max(1.0, float(out.sum()))


def jersey_gap(a: np.ndarray, b: np.ndarray) -> float:
    """0 for the same jersey, 1 for nothing in common (Hellinger distance)."""
    return float(np.sqrt(max(0.0, 1.0 - float(np.sum(np.sqrt(a * b))))))


def team_prototypes(people: list[tuple[float, float]], signatures: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray] | None:
    """Each team's typical jersey, from the snap frame: the offense stands behind the ball, the defense past it."""
    offense = [s for (_, y), s in zip(people, signatures) if y < -0.3]
    defense = [s for (_, y), s in zip(people, signatures) if y > 0.8]
    if not offense or not defense:
        return None
    o, d = np.median(offense, axis=0), np.median(defense, axis=0)
    return o / max(float(o.sum()), 1e-6), d / max(float(d.sum()), 1e-6)


def team_score(signature: np.ndarray, prototypes: tuple[np.ndarray, np.ndarray] | None) -> float:
    """+1 looks like the offense, -1 like the defense, 0 can't tell."""
    if prototypes is None:
        return 0.0
    to_offense, to_defense = jersey_gap(signature, prototypes[0]), jersey_gap(signature, prototypes[1])
    return (to_defense - to_offense) / (to_defense + to_offense + 1e-6)


@dataclass
class Tracklet:
    id: int
    points: list[tuple[int, float, float]]
    matched: list[tuple[int, int]]
    signature: np.ndarray
    scores: list[float] = field(default_factory=list)
    missed: int = 0

    @property
    def team(self) -> int:
        middle = float(np.median(self.scores)) if self.scores else 0.0
        return 1 if middle > TEAM_MARGIN else -1 if middle < -TEAM_MARGIN else 0

    def heading(self, ahead: int) -> tuple[float, float]:
        f1, x1, y1 = self.points[-1]
        if len(self.points) < VELOCITY_MIN_POINTS:
            return x1, y1
        f0, x0, y0 = self.points[-1 - min(VELOCITY_FRAMES, len(self.points) - 1)]
        vx, vy = (x1 - x0) / max(1, f1 - f0), (y1 - y0) / max(1, f1 - f0)
        speed = float(np.hypot(vx, vy))
        if speed > MAX_YARDS_PER_FRAME:
            vx, vy = vx * MAX_YARDS_PER_FRAME / speed, vy * MAX_YARDS_PER_FRAME / speed
        return x1 + vx * ahead, y1 + vy * ahead


def _other_team(team: float, score: float) -> bool:
    return (team > TEAM_MARGIN and score < -TEAM_MARGIN) or (team < -TEAM_MARGIN and score > TEAM_MARGIN)


def build_tracklets(per_frame, signatures, scores) -> list[Tracklet]:
    pieces: list[Tracklet] = []
    live: list[Tracklet] = []

    def start(f: int, j: int) -> None:
        t = Tracklet(len(pieces), [(f, *per_frame[f][j])], [(f, j)], signatures[f][j].copy(), [scores[f][j]])
        pieces.append(t)
        live.append(t)

    for j in range(len(per_frame[0])):
        start(0, j)
    for f in range(1, len(per_frame)):
        people = per_frame[f]
        pairs = []
        for t in live:
            hx, hy = t.heading(t.missed + 1)
            radius = STEP_YARDS + GROWTH_YARDS * t.missed
            team = float(np.median(t.scores))
            for j, (x, y) in enumerate(people):
                d = float(np.hypot(x - hx, y - hy))
                if d > radius or _other_team(team, scores[f][j]):
                    continue
                pairs.append((d + APPEARANCE_YARDS * jersey_gap(t.signature, signatures[f][j]), t.id, j))
        pairs.sort()
        taken: set[int] = set()
        used: set[int] = set()
        by_id = {t.id: t for t in live}
        for _, tid, j in pairs:
            if tid in taken or j in used:
                continue
            t = by_id[tid]
            t.points.append((f, *people[j]))
            t.matched.append((f, j))
            t.scores.append(scores[f][j])
            t.signature = SIGNATURE_MEMORY * t.signature + (1 - SIGNATURE_MEMORY) * signatures[f][j]
            t.missed = 0
            taken.add(tid)
            used.add(j)
        for t in live:
            if t.id not in taken:
                t.missed += 1
        live[:] = [t for t in live if t.missed <= TRACKLET_MISSED]
        for j in range(len(people)):
            if j not in used:
                start(f, j)
    return pieces


def _chain_points(chain: list[Tracklet]) -> list[tuple[int, float, float]]:
    return sorted(p for t in chain for p in t.points)


def _chain_end(chain: list[Tracklet], window: int = 4) -> tuple[int, float, float, float, float]:
    """Where the chain ends (averaged over its last few frames) and his velocity there (a straight-line fit over the
    last 12 frames: one frame's box jitter is a yard)."""
    pts = np.array(_chain_points(chain), dtype=float)
    fe = int(pts[-1, 0])
    tail = pts[pts[:, 0] >= fe - window]
    x, y = float(tail[:, 1].mean()), float(tail[:, 2].mean())
    recent = pts[pts[:, 0] >= fe - 12]
    if len(recent) < VELOCITY_MIN_POINTS or recent[-1, 0] - recent[0, 0] < 3:
        return fe, x, y, 0.0, 0.0
    t = recent[:, 0] - recent[:, 0].mean()
    vx = float((t * (recent[:, 1] - recent[:, 1].mean())).sum() / (t * t).sum())
    vy = float((t * (recent[:, 2] - recent[:, 2].mean())).sum() / (t * t).sum())
    speed = float(np.hypot(vx, vy))
    if speed > MAX_YARDS_PER_FRAME:
        vx, vy = vx * MAX_YARDS_PER_FRAME / speed, vy * MAX_YARDS_PER_FRAME / speed
    return fe, x, y, vx, vy


def stitch(pieces: list[Tracklet], fps: float = 30.0) -> tuple[list[list[Tracklet]], dict[int, int]]:
    """Chains, one per man followed from the snap, and each chain's team (+1 offense, -1 defense) by its root's id."""
    team_of: dict[int, int] = {}
    roots: list[Tracklet] = []
    for t in pieces:
        if t.points[0][0] == 0:
            roots.append(t)
            team_of[t.id] = 1 if t.points[0][2] < 0.3 else -1
    # A man the detector missed on the snap frame: his jersey has to say which team he is, on his own side of the ball.
    for t in sorted((t for t in pieces if 0 < t.points[0][0] <= ROOT_FRAMES and len(t.points) >= ROOT_MIN_POINTS), key=lambda t: t.points[0][0]):
        f0, x0, y0 = t.points[0]
        side = 1 if (t.team > 0 and y0 < 0.5) else -1 if (t.team < 0 and y0 > 0.5) else 0
        if not side:
            continue
        near = [[p for p in r.points if abs(p[0] - f0) <= 2] for r in roots]
        if any(n and np.hypot(n[0][1] - x0, n[0][2] - y0) < ROOT_CLEAR_YARDS for n in near):
            continue
        roots.append(t)
        team_of[t.id] = side
    chains = {r.id: [r] for r in roots}
    used = {r.id for r in roots}
    pool = [t for t in pieces if t.id not in used and t.points[0][0] > 0 and len(t.points) >= MIN_TRACKLET]
    while True:
        best = None
        for rid, chain in chains.items():
            fe, xe, ye, vx, vy = _chain_end(chain)
            team = team_of[rid]
            tail = chain[-1]
            for t in pool:
                if t.id in used:
                    continue
                fs = t.points[0][0]
                gap = fs - fe
                if gap <= 0 or gap > STITCH_MAX_GAP or (team > 0 and t.team < 0) or (team < 0 and t.team > 0):
                    continue
                head = np.array(t.points[:4], dtype=float)
                xs, ys = float(head[:, 1].mean()), float(head[:, 2].mean())
                secs = gap / fps
                allowed = STITCH_BASE_YARDS + 0.5 * STITCH_ACCEL * secs * secs
                off = float(np.hypot(xs - (xe + vx * gap), ys - (ye + vy * gap)))
                if off > allowed or np.hypot(xs - xe, ys - ye) > STITCH_BASE_YARDS + STITCH_TOP_SPEED * gap:
                    continue
                looks = jersey_gap(tail.signature, t.signature)
                if looks > STITCH_APPEARANCE:
                    continue
                cost = off / allowed + looks + 0.01 * gap
                if best is None or cost < best[0]:
                    best = (cost, rid, t)
        if best is None:
            break
        _, rid, t = best
        chains[rid].append(t)
        used.add(t.id)
    return [chains[r.id] for r in roots], team_of


@dataclass
class FollowedMan:
    """The same shape `tracks.Track` has, so `track_play` writes either tracker's answer the same way."""

    id: int
    start: tuple[float, float]
    points: list[tuple[int, float, float]]
    matched: list[tuple[int, int]]
    team: str


def follow_tracklets(per_frame, signatures, fps: float = 30.0) -> list[FollowedMan]:
    """`per_frame[f]` is everyone kept in frame f (yards, offense's view; frame 0 the snap frame), `signatures[f][j]`
    person j's `jersey_signature`."""
    prototypes = team_prototypes(per_frame[0], signatures[0]) if per_frame else None
    scores = [[team_score(s, prototypes) for s in frame] for frame in signatures]
    pieces = build_tracklets(per_frame, signatures, scores)
    chains, team_of = stitch(pieces, fps)
    out = []
    for i, chain in enumerate(chains):
        root = chain[0]
        out.append(
            FollowedMan(
                id=i,
                start=(root.points[0][1], root.points[0][2]),
                points=_chain_points(chain),
                matched=sorted(m for t in chain for m in t.matched),
                team="offense" if team_of[root.id] > 0 else "defense",
            )
        )
    return out

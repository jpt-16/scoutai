"""Pictures of the tracking, so a mistake can be seen instead of guessed at.

    python -m eval.tracks clips/ --out tracks --seconds 8 --tiles 2 --debug debug/

writes, for each clip, `debug/<clip>_trk_<n>s.jpg` (one per second after the snap) and one contact sheet
`debug/<clip>_trk_sheet.jpg` with all of them. Every box is a person the tracker kept, drawn in his
track's own color with his track number; offense is a thick box, defense a thin one, people nobody
is following a dashed grey box. The line behind each box is where that track has been, and a big red
ring marks the frame where a track moved faster than anyone can run (it was handed to another man). The
printed list says which tracks did that and when, so the picture and the list agree.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

# Far faster than a high-school player runs (yards a second, with room for detection noise on top of a
# sprint); a track that moves this fast changed men. The same limit `trackedPlay.ts` cuts a track at.
JUMP_YARDS_PER_SECOND = 24.0
JUMP_WINDOW_SECONDS = 0.3
TRAIL_SECONDS = 1.5
SHEET_WIDTH = 2400


def track_color(track_id: int) -> tuple[int, int, int]:
    """A bright, distinct BGR color per track number."""
    hue = int((track_id * 47) % 180)
    bgr = cv2.cvtColor(np.uint8([[[hue, 230, 255]]]), cv2.COLOR_HSV2BGR)[0, 0]
    return int(bgr[0]), int(bgr[1]), int(bgr[2])


def find_jumps(points: list[tuple[int, float, float]], fps: float) -> list[tuple[int, float]]:
    """(frame, yards a second) wherever a track moved faster than anyone runs, measured over a short window."""
    window = max(1, round(JUMP_WINDOW_SECONDS * fps))
    jumps: list[tuple[int, float]] = []
    for i in range(1, len(points)):
        j = i - 1
        while j > 0 and points[i][0] - points[j][0] < window:
            j -= 1
        frames = points[i][0] - points[j][0]
        if frames <= 0:
            continue
        speed = float(np.hypot(points[i][1] - points[j][1], points[i][2] - points[j][2])) / max(frames, window) * fps
        # One jump is seen from every frame within the window after it; report it once, where it began.
        if speed > JUMP_YARDS_PER_SECOND and not (jumps and points[i][0] - jumps[-1][0] <= window):
            jumps.append((points[i][0], speed))
    return jumps


def _foot(box) -> tuple[int, int]:
    return int((box[0] + box[2]) / 2), int(box[3])


def _dashed_box(img, box, color) -> None:
    x1, y1, x2, y2 = (int(v) for v in box[:4])
    for (ax, ay), (bx, by) in (((x1, y1), (x2, y1)), ((x2, y1), (x2, y2)), ((x2, y2), (x1, y2)), ((x1, y2), (x1, y1))):
        n = max(1, int(np.hypot(bx - ax, by - ay) // 8))
        for k in range(0, n, 2):
            a = (int(ax + (bx - ax) * k / n), int(ay + (by - ay) * k / n))
            b = (int(ax + (bx - ax) * (k + 1) / n), int(ay + (by - ay) * (k + 1) / n))
            cv2.line(img, a, b, color, 1)


def _in_frame(point: tuple[int, int], past: int, now: int, to_snap) -> tuple[int, int]:
    """A foot seen in frame `past`, as it would be drawn in frame `now` once the camera's own motion is taken
    out (both frames held to the snap frame), so a trail shows where the man went on the field."""
    if to_snap is None or past == now:
        return point
    snap_point = cv2.perspectiveTransform(np.float32([[list(point)]]), to_snap[past])
    back = cv2.perspectiveTransform(snap_point, np.linalg.inv(to_snap[now]))[0, 0]
    return int(back[0]), int(back[1])


def draw_frame(frame, boxes, tracks, labels, frame_index: int, fps: float, jumps_by_track: dict[int, list[int]], to_snap=None):
    img = frame.copy()
    by_person: dict[int, int] = {}
    for t in tracks:
        for f, j in t.matched:
            if f == frame_index:
                by_person[j] = t.id
    trail_from = frame_index - int(TRAIL_SECONDS * fps)
    for t in tracks:
        color = track_color(t.id)
        recent = [(f, j) for f, j in t.matched if trail_from <= f <= frame_index]
        pts = [_in_frame(_foot(boxes[f][j]), f, frame_index, to_snap) for f, j in recent if f < len(boxes) and j < len(boxes[f])]
        for a, b in zip(pts, pts[1:]):
            cv2.line(img, a, b, color, 2)
    for j, box in enumerate(boxes[frame_index]):
        t_id = by_person.get(j)
        x1, y1, x2, y2 = (int(v) for v in box[:4])
        if t_id is None:
            _dashed_box(img, box, (180, 180, 180))
            continue
        color = track_color(t_id)
        thick = 3 if labels[t_id] == "offense" else 1
        cv2.rectangle(img, (x1, y1), (x2, y2), color, thick)
        cv2.putText(img, str(t_id), (x1, max(12, y1 - 3)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2, cv2.LINE_AA)
        if frame_index in jumps_by_track.get(t_id, []):
            cv2.circle(img, _foot(box), 26, (0, 0, 255), 4)
    cv2.putText(img, f"{frame_index / fps:.1f}s after the snap   thick = offense, thin = defense, dashed = nobody follows him", (10, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 3, cv2.LINE_AA)
    cv2.putText(img, f"{frame_index / fps:.1f}s after the snap   thick = offense, thin = defense, dashed = nobody follows him", (10, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 1, cv2.LINE_AA)
    return img


def write_pictures(debug: dict, out_dir: Path, stem: str, every_seconds: float = 1.0) -> list[str]:
    """Writes the pictures and returns the printable report (which tracks jumped, and when)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    frames, boxes, tracks, labels, fps = debug["frames"], debug["boxes"], debug["tracks"], debug["labels"], debug["fps"]
    to_snap = debug.get("to_snap")
    jumps = {t.id: find_jumps(t.points, fps) for t in tracks}
    jump_frames = {i: [f for f, _ in js] for i, js in jumps.items()}
    report: list[str] = []
    for t in tracks:
        for f, speed in jumps[t.id]:
            report.append(f"track {t.id} ({labels[t.id]}) jumped at {f / fps:.2f}s: {speed:.0f} yd/s")
    # How much of the play each offensive man was actually found in: the detector's recall, the limit on any route read.
    for t in tracks:
        if labels[t.id] == "offense":
            report.append(f"track {t.id} (offense) found in {100 * len(t.points) / max(1, len(frames)):.0f}% of the play's frames")
    lost = [t for t in tracks if labels[t.id] == "offense" and t.points[-1][0] < len(frames) - 1 - int(0.5 * fps)]
    for t in lost:
        report.append(f"track {t.id} (offense) was lost at {t.points[-1][0] / fps:.2f}s")
    if not report:
        report.append("no track jumped and no offensive track was lost")

    shots = []
    step = max(1, round(every_seconds * fps))
    for f in range(0, len(frames), step):
        if f >= len(boxes):
            break
        img = draw_frame(frames[f], boxes, tracks, labels, f, fps, jump_frames, to_snap)
        cv2.imwrite(str(out_dir / f"{stem}_trk_{f / fps:.0f}s.jpg"), img)
        shots.append(img)
    if shots:
        cols = 2 if len(shots) <= 6 else 3
        cell_w = SHEET_WIDTH // cols
        cells = [cv2.resize(s, (cell_w, int(s.shape[0] * cell_w / s.shape[1]))) for s in shots]
        rows = []
        for r in range(0, len(cells), cols):
            row = cells[r : r + cols]
            while len(row) < cols:
                row.append(np.zeros_like(cells[0]))
            rows.append(np.hstack(row))
        cv2.imwrite(str(out_dir / f"{stem}_trk_sheet.jpg"), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 85])
    report.append(f"pictures: {out_dir}/{stem}_trk_sheet.jpg (all of them) and one per second")
    return report


def write_detections(debug: dict, out_dir: Path, stem: str) -> str:
    """Everyone the detector found in every frame (after the officials, bench and sideline were filtered out), as text:
    where each stood in yards from the ball in the offense's own view, his jersey color, how sure the detector was,
    and his box in the picture. No film in it. With this the tracking rules can be tried again and again off the Mac."""
    import json

    out_dir.mkdir(parents=True, exist_ok=True)
    frames = []
    for f, (people, colors, boxes) in enumerate(zip(debug["per_frame"], debug["colors"], debug["boxes"])):
        frames.append(
            [
                {
                    "x": round(float(x), 2),
                    "y": round(float(y), 2),
                    "color": [round(float(c), 0) for c in color],
                    "score": round(float(box[4]), 2),
                    "box": [round(float(v), 0) for v in box[:4]],
                }
                for (x, y), color, box in zip(people, colors, boxes)
            ]
        )
    # The tracker's own answer too, so a new rule can be compared with it.
    answer = [
        {"id": t.id, "team": debug["labels"][t.id], "matched": [[f, j] for f, j in t.matched]} for t in debug["tracks"]
    ]
    path = out_dir / f"{stem}_detections.json"
    path.write_text(json.dumps({"fps": debug["fps"], "frames": frames, "tracks": answer}))
    return f"detections: {path} ({sum(len(f) for f in frames)} people over {len(frames)} frames)"

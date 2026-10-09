"""Reads the offense's formation off one pre-snap frame per clip.

    python -m eval.calibrate clips/play_01.mp4      # once per clip (see that file)
    python -m eval.presnap clips/ --out ours.csv --debug debug/

For each clip with a calibration file beside it: grab the chosen frame, find the people
(RT-DETRv2, tiled so far-away players aren't missed), put each on the field in yards
through the calibration, split them into two teams by jersey color, call the team lined
up behind the other the offense, and name the formation from where they stand
(`formation.classify`). Writes `ours.csv` for `python -m eval.score`, and one picture per
clip in `--debug` showing who was found, which team, and what it called it, so a wrong
answer can be traced to a missed player, a bad calibration or a rule.

Not yet checked against real game film: the first runs are for finding what to tune.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
from pathlib import Path

import cv2
import numpy as np

from devices import pick_device
from geometry import CalibrationPoints, build_homography, transform_point

from .formation import Spot, classify
from .teams import pick_offense, two_means

CHECKPOINT = os.environ.get("MODEL_CHECKPOINT", "PekingU/rtdetr_v2_r18vd")
CONFIDENCE = 0.4
# Players further than this from the ball (yards, either way) are the crowd, the sideline
# or the other end of the field.
MAX_DEPTH = 22.0
FIELD_WIDTH = 160 / 3
SIDE_MARGIN = 3.0


class Detector:
    def __init__(self) -> None:
        import torch
        from transformers import AutoImageProcessor, RTDetrV2ForObjectDetection

        self.torch = torch
        self.device = pick_device()
        self.processor = AutoImageProcessor.from_pretrained(CHECKPOINT)
        self.model = RTDetrV2ForObjectDetection.from_pretrained(CHECKPOINT).to(self.device).eval()
        self.person = {i for i, n in self.model.config.id2label.items() if n.lower() == "person"}

    def _run(self, rgb: np.ndarray) -> list[tuple[float, float, float, float, float]]:
        torch = self.torch
        with torch.inference_mode():
            inputs = self.processor(images=rgb, return_tensors="pt").to(self.device)
            outputs = self.model(**inputs)
            result = self.processor.post_process_object_detection(
                outputs, target_sizes=torch.tensor([rgb.shape[:2]]), threshold=CONFIDENCE
            )[0]
        return [
            (*box.tolist(), float(score))
            for box, score, label in zip(result["boxes"], result["scores"], result["labels"])
            if int(label) in self.person
        ]

    def people(self, frame_bgr: np.ndarray, tiles: int) -> list[tuple[float, float, float, float, float]]:
        """Boxes (x1, y1, x2, y2, score). `tiles` > 1 runs the detector on overlapping tiles
        too: a player is only 20-40 pixels tall in a wide shot, and the model sees 640."""
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        h, w = rgb.shape[:2]
        found = self._run(rgb)
        if tiles > 1:
            tw, th = int(w / tiles * 1.25), int(h / tiles * 1.25)
            for ty in np.linspace(0, h - th, tiles).astype(int):
                for tx in np.linspace(0, w - tw, tiles).astype(int):
                    found += [
                        (x1 + tx, y1 + ty, x2 + tx, y2 + ty, s)
                        for x1, y1, x2, y2, s in self._run(rgb[ty : ty + th, tx : tx + tw])
                    ]
        if not found:
            return []
        boxes = [[b[0], b[1], b[2] - b[0], b[3] - b[1]] for b in found]
        keep = cv2.dnn.NMSBoxes(boxes, [b[4] for b in found], CONFIDENCE, 0.45)
        return [found[int(i)] for i in np.array(keep).flatten()]


def torso_color(frame_bgr: np.ndarray, box: tuple[float, float, float, float, float]) -> tuple[float, float, float]:
    """Typical Lab color of the middle of the body: the jersey, not the helmet or the legs."""
    x1, y1, x2, y2, _ = box
    w, h = x2 - x1, y2 - y1
    crop = frame_bgr[int(y1 + 0.2 * h) : int(y1 + 0.5 * h), int(x1 + 0.3 * w) : int(x2 - 0.3 * w)]
    if crop.size == 0:
        return (0.0, 0.0, 0.0)
    # The median, not the mean: a player half hidden behind another keeps his own color.
    lab = np.median(cv2.cvtColor(crop, cv2.COLOR_BGR2LAB).reshape(-1, 3), axis=0)
    return float(lab[0]), float(lab[1]), float(lab[2])


def read_clip(path: Path, detector: Detector, tiles: int, debug_dir: Path | None) -> dict:
    calib = json.loads(path.with_suffix(".json").read_text())
    direction = calib["direction"]
    cap = cv2.VideoCapture(str(path))
    cap.set(cv2.CAP_PROP_POS_FRAMES, calib["frame"])
    ok, frame = cap.read()
    if not ok:
        raise RuntimeError(f"can't read frame {calib['frame']} of {path}")

    matrix = build_homography(CalibrationPoints(source=calib["source"], destination=calib["destination"]))
    ball = transform_point(matrix, *calib["ball"])

    players = []  # (box, offense-view x, y in yards from the ball)
    for box in detector.people(frame, tiles):
        # Where he stands: the middle of his feet.
        fx, fy = transform_point(matrix, (box[0] + box[2]) / 2, box[3])
        if not (-SIDE_MARGIN <= fx <= FIELD_WIDTH + SIDE_MARGIN) or abs(fy - ball[1]) > MAX_DEPTH:
            continue
        players.append((box, (fx - ball[0]) * direction, (fy - ball[1]) * direction))

    labels = two_means([torso_color(frame, b) for b, _, _ in players])
    offense_label = pick_offense(labels, [y for _, _, y in players]) if players else 0
    offense = [Spot(x, y) for (b, x, y), l in zip(players, labels) if l == offense_label]
    formation = classify(offense)

    if debug_dir:
        debug_dir.mkdir(parents=True, exist_ok=True)
        for (box, x, y), l in zip(players, labels):
            color = (0, 200, 0) if l == offense_label else (0, 0, 220)
            cv2.rectangle(frame, (int(box[0]), int(box[1])), (int(box[2]), int(box[3])), color, 2)
            cv2.putText(frame, f"{x:.0f},{y:.0f}", (int(box[0]), int(box[1]) - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
        cv2.putText(frame, f"{formation.key} {formation.strength or ''} | {formation.notes}", (20, 40),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
        cv2.imwrite(str(debug_dir / f"{path.stem}.jpg"), frame)

    return {"formation": formation, "found": len(players), "offense": len(offense)}


def play_number(path: Path, fallback: int) -> str:
    m = re.search(r"\d+", path.stem)
    return str(int(m.group())) if m else str(fallback)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("clips", type=Path, help="folder of clips, each with a calibration .json beside it")
    ap.add_argument("--out", type=Path, default=Path("ours.csv"))
    ap.add_argument("--debug", type=Path, help="folder for one annotated picture per clip")
    ap.add_argument("--tiles", type=int, default=2, help="detector tiles per side (1 = whole frame only)")
    args = ap.parse_args()

    clips = sorted(p for p in args.clips.iterdir() if p.suffix.lower() in {".mp4", ".mov", ".m4v"})
    todo = [p for p in clips if p.with_suffix(".json").exists()]
    if not todo:
        raise SystemExit("no clips with a calibration file; run `python -m eval.calibrate <clip>` first")
    detector = Detector()
    print(f"detector {CHECKPOINT} on {detector.device}")

    rows = []
    for i, clip in enumerate(todo, start=1):
        result = read_clip(clip, detector, args.tiles, args.debug)
        f = result["formation"]
        print(f"{clip.name}: {f.key} {f.strength or ''} ({result['offense']} of {result['found']} found) {f.notes}")
        rows.append({"PLAY #": play_number(clip, i), "OFF FORM": f.key, "OFF STR": f.strength or "", "NOTES": f.notes})
    with args.out.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["PLAY #", "OFF FORM", "OFF STR", "NOTES"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()

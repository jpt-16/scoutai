"""ScoutCard AI — video-analytics microservice.

Takes a short game-film clip plus 4 calibration point pairs, tracks every
person in the clip across frames, and converts each track's pixel path into
true top-down field-yardage coordinates via a homography transform.

This is a SEPARATE, GPU-oriented service from the main Next.js app. It is not
built or deployed by Vercel (see ../CLAUDE.md and ./README.md) — it needs a
host with an NVIDIA GPU. Run it locally with:

    pip install -r requirements.txt
    uvicorn main:app --host 0.0.0.0 --port 8000

Licensing note (see README): detection uses HuggingFace `transformers`' own
RT-DETRv2 implementation (Apache-2.0) rather than the `ultralytics` package,
and tracking uses Roboflow's `supervision` ByteTrack (MIT) — the `ultralytics`
PyPI package is AGPL-3.0 for every model it serves, including RT-DETR run
through it, so it's avoided entirely here, not just for YOLO specifically.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from typing import Optional

import cv2
import numpy as np
import torch
from devices import pick_device
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from geometry import (
    CalibrationPoints,
    PlayerRoute,
    ProcessPlayResponse,
    RoutePoint,
    build_homography,
    transform_point,
)

logger = logging.getLogger("video_service")
logging.basicConfig(level=logging.INFO)

# --------------------------------------------------------------------------
# Config (env vars, all with sane defaults so `uvicorn main:app` just works)
# --------------------------------------------------------------------------

MODEL_CHECKPOINT = os.environ.get("MODEL_CHECKPOINT", "PekingU/rtdetr_v2_r18vd")
CONFIDENCE_THRESHOLD = float(os.environ.get("CONFIDENCE_THRESHOLD", "0.4"))
# Clips are meant to be single plays (a few seconds). Reject anything wildly
# longer so a bad upload can't tie up a GPU worker for minutes.
MAX_VIDEO_SECONDS = float(os.environ.get("MAX_VIDEO_SECONDS", "20"))
# How many consecutive frames a track can go undetected (e.g. a pile-up,
# a ref crossing in front of a player) before ByteTrack gives up on it and
# a reappearance gets a new player number. Generous by default since these
# are short clips and re-identification after a long occlusion isn't solved
# here — see the note on `_assign_stable_player_ids` below.
LOST_TRACK_BUFFER = int(os.environ.get("LOST_TRACK_BUFFER", "60"))
# Optional path to a pre-built TensorRT engine for the detector. Building
# that engine (ONNX export -> `trtexec`) is a separate, host-specific,
# offline step — not something this service does inline per-request. When
# unset (the default), inference runs the HF model directly on GPU in fp16.
TENSORRT_ENGINE_PATH = os.environ.get("TENSORRT_ENGINE_PATH") or None

DEVICE = pick_device()  # cuda, then Apple's mps (a Mac), then cpu


# --------------------------------------------------------------------------
# Detection + tracking
#
# (CalibrationPoints/RoutePoint/PlayerRoute/ProcessPlayResponse and the
# homography math live in geometry.py, imported above — kept separate so
# they, and their tests, don't require torch/transformers/supervision.)
# --------------------------------------------------------------------------


class PersonDetector:
    """Wraps a person detector + multi-object tracker.

    Loaded once at process startup (see `lifespan` below) and reused across
    requests — reloading model weights per-request would make every call
    pay a multi-second cold-start cost.
    """

    def __init__(self, checkpoint: str, device: torch.device, tensorrt_engine_path: Optional[str]):
        # Imported lazily so `python -m py_compile main.py` and the pure-math
        # tests (test_homography.py) don't require torch/transformers to be
        # installed just to check this file parses.
        from transformers import AutoImageProcessor, RTDetrV2ForObjectDetection

        self.device = device
        self.processor = AutoImageProcessor.from_pretrained(checkpoint)
        self.model = RTDetrV2ForObjectDetection.from_pretrained(checkpoint)
        self.model.to(device)
        self.model.eval()
        if device.type == "cuda":
            self.model.half()

        self._person_label_ids = {
            label_id
            for label_id, name in self.model.config.id2label.items()
            if name.lower() == "person"
        }
        if not self._person_label_ids:
            raise RuntimeError(f"Checkpoint {checkpoint!r} has no 'person' class in its label map")

        self._trt_session = None
        if tensorrt_engine_path:
            # Integration point, not a working runtime: loading and executing
            # a compiled TensorRT engine is highly specific to the exact
            # TensorRT/CUDA/driver versions on the deployment host, and the
            # engine itself must already have been built there (see README's
            # "Optional: TensorRT" section). Faking a generic loader here
            # would silently do nothing useful, which is worse than being
            # explicit that this is where a real deployment plugs one in.
            raise NotImplementedError(
                "TENSORRT_ENGINE_PATH is set, but loading a pre-built TensorRT engine is "
                "host-specific and must be implemented for your exact deployment target. "
                "See README.md's TensorRT section. Unset TENSORRT_ENGINE_PATH to run the "
                "standard PyTorch model instead."
            )

    @torch.inference_mode()
    def detect(self, frame_bgr: np.ndarray) -> sv.Detections:
        import supervision as sv

        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        inputs = self.processor(images=frame_rgb, return_tensors="pt").to(self.device)
        if self.device.type == "cuda":
            inputs = {k: v.half() if v.is_floating_point() else v for k, v in inputs.items()}

        outputs = self.model(**inputs)
        target_sizes = torch.tensor([frame_rgb.shape[:2]])
        results = self.processor.post_process_object_detection(
            outputs, target_sizes=target_sizes, threshold=CONFIDENCE_THRESHOLD
        )[0]

        boxes, scores, labels = [], [], []
        for box, score, label in zip(results["boxes"], results["scores"], results["labels"]):
            if int(label) in self._person_label_ids:
                boxes.append(box.tolist())
                scores.append(float(score))
                labels.append(0)  # single class ("person") for the tracker

        if not boxes:
            return sv.Detections.empty()

        return sv.Detections(
            xyxy=np.array(boxes, dtype=np.float32),
            confidence=np.array(scores, dtype=np.float32),
            class_id=np.array(labels, dtype=int),
        )


# --------------------------------------------------------------------------
# Frame loop
# --------------------------------------------------------------------------


def _assign_stable_player_ids(
    raw_tracks: dict[int, list[RoutePoint]]
) -> dict[str, PlayerRoute]:
    """Renames raw ByteTrack ids (which can be sparse, large, and don't
    start at 1) to `Player_1`, `Player_2`, ... in order of first appearance,
    which is what client code actually wants to display/iterate over.

    Note: this does not perform re-identification. If a player is fully
    occluded for longer than LOST_TRACK_BUFFER frames and reappears,
    ByteTrack will hand them a new raw id, and they'll show up here as a
    *new* Player_N rather than a continuation of their earlier route. Full
    re-ID after a long occlusion is a separate, harder CV problem this
    service does not attempt to solve.
    """
    first_seen = {tid: min(p.frame for p in points) for tid, points in raw_tracks.items()}
    ordered_ids = sorted(raw_tracks, key=lambda tid: first_seen[tid])
    return {
        f"Player_{i + 1}": PlayerRoute(route=raw_tracks[tid])
        for i, tid in enumerate(ordered_ids)
    }


def process_video(video_path: str, homography: np.ndarray, detector: PersonDetector) -> dict[str, PlayerRoute]:
    """Decodes the clip frame-by-frame (never loading the whole video into
    memory at once), runs detection + tracking, and returns each player's
    transformed route.
    """
    import supervision as sv

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail="Could not open video file (corrupt or unsupported format)")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    max_frames = int(MAX_VIDEO_SECONDS * fps)

    tracker = sv.ByteTrack(lost_track_buffer=LOST_TRACK_BUFFER)
    raw_tracks: dict[int, list[RoutePoint]] = {}

    frame_index = 0
    try:
        while True:
            if frame_index >= max_frames:
                raise HTTPException(
                    status_code=413,
                    detail=f"Clip exceeds the {MAX_VIDEO_SECONDS:.0f}s processing limit",
                )

            ok, frame = cap.read()
            if not ok:
                break  # end of clip (or an unreadable frame — either way, stop cleanly)

            detections = detector.detect(frame)
            tracked = tracker.update_with_detections(detections)

            for xyxy, tracker_id in zip(tracked.xyxy, tracked.tracker_id):
                if tracker_id is None:
                    continue  # ByteTrack hasn't confirmed this detection as a track yet
                x1, y1, x2, y2 = xyxy
                feet_x, feet_y = (x1 + x2) / 2.0, y2  # bottom-center: where the feet meet the turf
                field_x, field_y = transform_point(homography, feet_x, feet_y)
                raw_tracks.setdefault(int(tracker_id), []).append(
                    RoutePoint(frame=frame_index, x=round(field_x, 2), y=round(field_y, 2))
                )

            frame_index += 1
    finally:
        cap.release()

    if frame_index == 0:
        raise HTTPException(status_code=400, detail="Video contained no readable frames")

    # No players tracked isn't an error condition (e.g. an empty-field clip) —
    # it's a valid, if unhelpful, result.
    return _assign_stable_player_ids(raw_tracks)


# --------------------------------------------------------------------------
# FastAPI app
# --------------------------------------------------------------------------

_detector: Optional[PersonDetector] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _detector
    logger.info("Loading detector %s on %s ...", MODEL_CHECKPOINT, DEVICE)
    _detector = PersonDetector(MODEL_CHECKPOINT, DEVICE, TENSORRT_ENGINE_PATH)
    logger.info("Detector ready.")
    yield
    _detector = None


app = FastAPI(title="ScoutCard AI — Video Analytics Service", lifespan=lifespan)


@app.post("/api/v1/process-play", response_model=ProcessPlayResponse)
async def process_play(
    file: UploadFile = File(..., description="Game-film clip (.mp4/.mov)"),
    calibration_points: str = Form(
        ..., description='JSON: {"source": [[x,y]x4], "destination": [[x,y]x4]}'
    ),
) -> ProcessPlayResponse:
    if _detector is None:
        raise HTTPException(status_code=503, detail="Detector is not loaded yet")

    # --- Parse + validate calibration ------------------------------------
    try:
        raw = json.loads(calibration_points)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"calibration_points is not valid JSON: {exc}") from exc

    try:
        calibration = CalibrationPoints.model_validate(raw)
    except Exception as exc:  # pydantic.ValidationError, plus any TypeError from malformed shapes
        raise HTTPException(status_code=400, detail=f"Invalid calibration_points: {exc}") from exc

    homography = build_homography(calibration)

    # --- Stream the upload to a temp file, always clean it up ------------
    suffix = os.path.splitext(file.filename or "")[1] or ".mp4"
    tmp_path: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name
            while chunk := await file.read(1024 * 1024):
                tmp.write(chunk)

        play_data = process_video(tmp_path, homography, _detector)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — deliberately broad: never leak internals to the client
        logger.exception("Unexpected error processing %s", file.filename)
        raise HTTPException(status_code=500, detail="Internal error while processing the clip") from exc
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

    return ProcessPlayResponse(
        status="success",
        total_players_tracked=len(play_data),
        play_data=play_data,
    )

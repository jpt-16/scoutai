# ScoutCard AI — video-analytics service

A separate Python/FastAPI microservice: given a game-film clip and 4 calibration
points, it tracks every player and returns their paths in true field-yardage
coordinates.

**This is not part of the Next.js app's Vercel deployment.** `next build` only
touches `src/`, so Vercel never sees this directory — and it couldn't run there
anyway: this needs sustained GPU access and a long-running process, which
Vercel's serverless functions don't provide. It's meant to be deployed
separately, to a GPU-capable host (a GPU VM, or a GPU-oriented platform like
Modal or RunPod — not yet decided; this README covers running it, not where).

Turning the player-route JSON this returns into an actual scout card
(formation, play call, route-tree labels) is a separate, later pipeline stage
not covered by this service.

## Why these libraries (licensing)

The `ultralytics` PyPI package is AGPL-3.0-licensed for every model it serves —
including its own `RTDETR` class — so running RT-DETR *through* `ultralytics`
doesn't avoid that license, only avoiding the package entirely does. Instead:

- **Detection:** HuggingFace `transformers`' native RT-DETRv2
  (`RTDetrV2ForObjectDetection`) — Apache-2.0, no `ultralytics` dependency.
- **Tracking:** Roboflow's `supervision` library's `ByteTrack` — MIT, and
  implemented independently of `ultralytics`.

This is my best technical read of the current license terms, not legal advice —
worth a quick double-check before shipping this commercially.

## Running locally

```bash
# 1. Install torch matching your GPU's CUDA version first (see
#    https://pytorch.org/get-started/locally/). Example for CUDA 12.4:
pip install torch --index-url https://download.pytorch.org/whl/cu124

# 2. Everything else
pip install -r requirements.txt

# 3. Run it (loads the detection model on startup, so the first request
#    after boot doesn't pay that cost)
uvicorn main:app --host 0.0.0.0 --port 8000
```

Without a CUDA GPU it still runs, on CPU — much slower, but fine for testing
the API contract and homography math.

## Calling it

```bash
curl -X POST http://localhost:8000/api/v1/process-play \
  -F "file=@clip.mp4" \
  -F 'calibration_points={
        "source": [[420, 180], [1500, 180], [1850, 900], [80, 900]],
        "destination": [[0, 0], [53.3, 0], [53.3, 10], [0, 10]]
      }'
```

`source` is 4 pixel points clicked on the video frame; `destination` is where
those same 4 points sit in true field yards. Both must have exactly 4 entries,
in matching order — `cv2.getPerspectiveTransform` is an exact solve for 4
pairs, not a best-fit for more.

Response shape:

```json
{
  "status": "success",
  "total_players_tracked": 11,
  "play_data": {
    "Player_1": { "route": [{ "frame": 0, "x": 12.4, "y": 4.5 }, ...] },
    "Player_2": { "route": [...] }
  }
}
```

`Player_N` numbers are assigned in order of first appearance in the clip, not
raw tracker ids. Note the known limitation in `main.py`'s
`_assign_stable_player_ids`: a player fully hidden for longer than
`LOST_TRACK_BUFFER` frames gets a new number on reappearing rather than a
continuous route — full re-identification after a long occlusion isn't
attempted here.

## Optional: TensorRT

`TENSORRT_ENGINE_PATH` is a recognized config hook in `main.py`, but building
the actual engine (export the model to ONNX, then compile with `trtexec` for
your exact TensorRT/CUDA/driver versions) is a separate, offline, host-specific
step this service doesn't perform for you. Until you've built and wired one up,
leave `TENSORRT_ENGINE_PATH` unset — the service runs the standard PyTorch
model in fp16 on GPU, which is a real speed win on its own.

## OpenCV + CUDA

The pinned `opencv-python-headless` wheel is CPU-only for video decode/frame
ops (only the detection model itself runs on GPU). `cv2.cuda` /
`cv2.cudacodec` (hardware-accelerated decode) need a custom OpenCV build with
NVDEC support — worth adding later on a GPU host if decode becomes the
bottleneck, but not assumed to "just work" out of a stock pip install.

## Testing

```bash
pip install pytest opencv-python-headless numpy fastapi pydantic
pytest test_homography.py
```

This covers the homography math and calibration validation — no GPU, model,
or real video needed. It does not cover detection/tracking/the actual
endpoint (needs torch + transformers + supervision, and ideally a GPU); once
deployed, sanity-check that with the `curl` example above against a short
real clip and confirm the yardage numbers look right for the clip's geometry.

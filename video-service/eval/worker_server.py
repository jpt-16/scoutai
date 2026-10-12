"""The web server in front of `eval.worker`: the app POSTs a job here and gets a 202 straight back.

    FILM_WORKER_SECRET=...  uvicorn eval.worker_server:app --host 0.0.0.0 --port 8080

    POST /jobs     a shard, split or assemble dispatch (see eval.worker), `Authorization: Bearer <secret>`
    GET  /health   {"ok": true, "device": "cuda"}   (no auth: it says nothing about any game)

The work happens after the answer, on a few background threads, so the host must keep running
once it has replied (a GPU box, or a serverless GPU service set to keep its CPU on between
request and finish). The detector is loaded once, the first time it is needed, and shared.
"""

from __future__ import annotations

import os
import threading
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, Header, HTTPException, Request

from .worker import Http, WorkerError, check_secret, run_assemble, run_shard, run_split

app = FastAPI(title="ScoutCard film worker")

_detector = None
_detector_lock = threading.Lock()
_pool = ThreadPoolExecutor(max_workers=int(os.environ.get("SHARDS_AT_ONCE", "2")))


def get_detector():
    """Loaded on first use, once (the weights are big; a health check shouldn't pay for them)."""
    global _detector
    with _detector_lock:
        if _detector is None:
            from .presnap import Detector

            _detector = Detector()
        return _detector


def _run(dispatch: dict) -> None:
    http = Http()
    try:
        if dispatch["type"] == "shard":
            run_shard(dispatch, get_detector(), http)
        elif dispatch["type"] == "split":
            run_split(dispatch, http)  # motion only: no detector, no GPU
        else:
            run_assemble(dispatch, http)
    except Exception as error:  # reported to the app by the runner where it can be; logged here either way
        print(f"job {dispatch.get('jobId')} {dispatch.get('type')} failed: {error!r}")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "device": str(getattr(_detector, "device", "not loaded yet"))}


@app.post("/jobs", status_code=202)
async def submit(request: Request, authorization: str | None = Header(default=None)) -> dict:
    if not check_secret(authorization, os.environ.get("FILM_WORKER_SECRET", "")):
        raise HTTPException(status_code=401, detail="bad secret")
    try:
        dispatch = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="not JSON")
    if not isinstance(dispatch, dict) or dispatch.get("type") not in ("shard", "assemble", "split"):
        raise HTTPException(status_code=400, detail="type must be shard, assemble or split")
    try:  # refuse a malformed job now, not minutes later
        if dispatch["type"] == "shard":
            required = ("jobId", "callbackUrl", "token", "clips")
        elif dispatch["type"] == "split":
            required = ("jobId", "callbackUrl", "token", "video")
        else:
            required = ("jobId", "callbackUrl", "token", "tracks", "forms", "resultPutUrl")
        missing = [k for k in required if k not in dispatch]
        if missing:
            raise WorkerError(f"dispatch is missing {', '.join(missing)}")
    except WorkerError as error:
        raise HTTPException(status_code=400, detail=str(error))
    _pool.submit(_run, dispatch)
    return {"accepted": True}

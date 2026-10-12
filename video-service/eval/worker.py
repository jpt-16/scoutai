"""The hosted worker: what runs when a coach uploads a game.

The app (Next.js, `/api/film/*`) can't run the analyzer itself, so it hands the work to this
over HTTP. Two kinds of job come in, both described by a small JSON "dispatch":

    shard     a few clips of the game. Each is downloaded, run through `eval.clipjob.process_clip`
              (calibrate, read the formation, follow every player) on a thread of its own, its
              tracks uploaded, and its status posted back. A big game is split into several
              shards so a host that scales out can work on them at once.
    assemble  sent by the app once every clip has reported: download all the tracks, build the
              scout cards with `scripts/tracks-to-cards.ts`, upload `game.json`, report back.

    split     film that didn't come from Hudl is one long video, not a clip a play. The worker reads it
              (ranges over HTTP, no whole download), finds each snap with `eval.split`, and reports the
              plan: start, snap and end of every play. The app turns the plan into clips; a shard's clip
              is then `source: {url, start, end}`, a stretch of that video the worker cuts out itself.

The worker never holds the film longer than the job: each job works in its own temporary folder,
which is deleted when it finishes, success or not (the clips are minors).

Everything the worker needs to talk to the app is in the dispatch (the URLs to fetch clips and send
results to, and a per-job token that every request carries), so it holds no storage credentials of
its own: the app is the only thing that touches the film store.
`eval.worker_server` is the thin web server that receives dispatches.
"""

from __future__ import annotations

import csv
import dataclasses
import gzip
import hmac
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

from .clipjob import DONE, ClipResult, process_clip
from .split import split_video, write_range

REPO = Path(__file__).resolve().parents[2]
TOKEN_HEADER = "x-film-token"


class WorkerError(Exception):
    pass


class Http:
    """The three things the worker does over the network, with retries (a callback that fails once
    must not lose a clip's result). Tests swap this for a recorder."""

    def __init__(self, retries: int = 3, backoff: float = 1.0, timeout: float = 120.0, sleep: Callable[[float], None] = time.sleep):
        self.retries, self.backoff, self.timeout, self.sleep = retries, backoff, timeout, sleep

    def _send(self, request: urllib.request.Request, sink: Path | None = None) -> bytes:
        last: Exception | None = None
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    if sink is None:
                        return response.read()
                    with sink.open("wb") as fh:
                        shutil.copyfileobj(response, fh)
                    return b""
            except urllib.error.HTTPError as error:
                last = error
                if error.code < 500 and error.code != 429:  # a refusal won't change on retry
                    break
            except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
                last = error
            if attempt + 1 < self.retries:
                self.sleep(self.backoff * 2**attempt)
        raise WorkerError(f"{request.get_method()} {request.full_url.split('?')[0]} failed: {last}")

    def download(self, url: str, dest: Path, token: str | None = None) -> None:
        headers = {TOKEN_HEADER: token} if token else {}
        self._send(urllib.request.Request(url, method="GET", headers=headers), sink=dest)

    def put(self, url: str, path: Path, token: str | None = None) -> None:
        """Uploads a file gzipped (a game file is a few MB of JSON; the app's functions take 4.5 MB a request)."""
        headers = {"Content-Type": "application/gzip"}
        if token:
            headers[TOKEN_HEADER] = token
        self._send(urllib.request.Request(url, data=gzip.compress(path.read_bytes()), method="PUT", headers=headers))

    def post_json(self, url: str, payload: dict, token: str) -> None:
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode(),
            method="POST",
            headers={"Content-Type": "application/json", TOKEN_HEADER: token},
        )
        self._send(request)


class SharedDetector:
    """One detector for every thread. The GPU does one thing at a time anyway; this keeps two threads
    from calling the model at once, while the camera and tracking work (CPU) overlaps freely."""

    def __init__(self, detector) -> None:
        self._detector = detector
        self._lock = threading.Lock()

    def people(self, *args, **kwargs):
        with self._lock:
            return self._detector.people(*args, **kwargs)

    def people_in_windows(self, *args, **kwargs):
        with self._lock:
            return self._detector.people_in_windows(*args, **kwargs)

    def __getattr__(self, name):  # device, model, and anything else is read straight through
        return getattr(self._detector, name)


def _safe_name(name: str) -> str:
    """A clip name from the app is a bare file name; anything with a path in it is refused."""
    clean = Path(str(name)).name
    if not clean or clean != name or clean.startswith("."):
        raise WorkerError(f"bad clip name: {name!r}")
    return clean


def _require(dispatch: dict, *keys: str) -> None:
    missing = [k for k in keys if k not in dispatch]
    if missing:
        raise WorkerError(f"dispatch is missing {', '.join(missing)}")


def resolve_source(url: str, http: Http, token: str, workdir: Path) -> str:
    """Where to read a long video from: the URL itself when OpenCV can open and read it (it asks for just the
    byte ranges it needs, so a play at minute 80 costs a few MB, not the game), else the whole video downloaded
    once into `workdir`."""
    import cv2

    cap = cv2.VideoCapture(url)
    try:
        if cap.isOpened() and cap.read()[0]:
            return url
    finally:
        cap.release()
    local = workdir / "source" / f"{abs(hash(url.split('?')[0]))}.mp4"
    if not local.exists():
        local.parent.mkdir(parents=True, exist_ok=True)
        http.download(url, local, token)
    return str(local)


def cut_source(source: str, start: float, end: float, dest: Path) -> int:
    """One play, out of a long video, as its own clip. Returns the frames written (0 means nothing was there)."""
    import cv2

    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise WorkerError("could not open the video")
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        size = (int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
        return write_range(cap, fps, size, start, end, dest)
    finally:
        cap.release()


def run_shard(dispatch: dict, detector, http: Http, *, threads: int | None = None, workdir: Path | None = None) -> list[ClipResult]:
    """Process the clips of one shard, reporting each as it finishes. Returns the results (for tests)."""
    _require(dispatch, "jobId", "callbackUrl", "token", "clips")
    options = dispatch.get("options") or {}
    seconds = float(options.get("seconds", 8.0))
    tiles = int(options.get("tiles", 3))
    region = bool(options.get("region", True))
    callback, token = dispatch["callbackUrl"], dispatch["token"]
    shared = SharedDetector(detector)
    threads = threads or int(os.environ.get("WORKER_THREADS", "0")) or min(4, os.cpu_count() or 1)

    own = workdir is None
    root = workdir or Path(tempfile.mkdtemp(prefix="film-shard-"))
    clips_dir, tracks_dir, debug_dir = root / "clips", root / "tracks", root / "debug"
    for d in (clips_dir, tracks_dir, debug_dir):
        d.mkdir(parents=True, exist_ok=True)

    def one(entry: dict) -> ClipResult:
        index = int(entry["index"])
        name = str(entry.get("name", ""))
        clip: Path | None = None
        try:
            clip = clips_dir / _safe_name(name)
            if "source" in entry:  # a stretch of a long video: cut it out
                src = entry["source"]
                source = resolve_source(src["url"], http, token, root)
                if cut_source(source, float(src["start"]), float(src["end"]), clip) < 10:
                    raise WorkerError("nothing could be cut from the video at that time")
            else:
                http.download(entry["url"], clip, token)
            result = process_clip(clip, shared, tracks_dir, debug_dir, seconds=seconds, tiles=tiles, region=region)
            if result.status == DONE and result.tracks is not None:
                http.put(entry["tracksPutUrl"], result.tracks, token)
        except Exception as error:  # a bad name, a cut or download or upload that never worked: this clip failed, the rest go on
            result = ClipResult(name, "failed", reason=f"{type(error).__name__}: {error}")
        finally:
            if clip is not None:
                clip.unlink(missing_ok=True)  # the film goes as soon as it has been read
        try:
            http.post_json(
                callback,
                {
                    "type": "clip",
                    "index": index,
                    "name": name,
                    "status": result.status,
                    "reason": result.reason,
                    "formation": result.formation,
                    "strength": result.strength,
                    "seconds": round(result.seconds, 1),
                },
                token,
            )
        except WorkerError as error:
            print(f"could not report {name}: {error}")
        return result

    try:
        with ThreadPoolExecutor(max_workers=max(1, threads)) as pool:
            return list(pool.map(one, dispatch["clips"]))
    finally:
        if own:
            shutil.rmtree(root, ignore_errors=True)


def run_assemble(
    dispatch: dict,
    http: Http,
    *,
    build: Callable[[Path, Path, Path], None] | None = None,
    workdir: Path | None = None,
) -> int:
    """Download every clip's tracks, build `game.json` with the app's own card code, upload it. Returns the
    number of cards. `build(tracks_dir, formations_csv, out)` is the card builder (a stub in tests)."""
    _require(dispatch, "jobId", "callbackUrl", "token", "tracks", "forms", "resultPutUrl")
    callback, token = dispatch["callbackUrl"], dispatch["token"]
    own = workdir is None
    root = workdir or Path(tempfile.mkdtemp(prefix="film-assemble-"))
    tracks_dir = root / "tracks"
    tracks_dir.mkdir(parents=True, exist_ok=True)
    try:
        for entry in dispatch["tracks"]:
            name = _safe_name(entry["name"])
            http.download(entry["url"], tracks_dir / f"{Path(name).stem}.json", token)
        formations = root / "ours.csv"
        with formations.open("w", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=["PLAY #", "OFF FORM", "OFF STR"])
            writer.writeheader()
            writer.writerows(dispatch["forms"])
        out = root / "game.json"
        (build or build_cards)(tracks_dir, formations, out)
        plays = len(json.loads(out.read_text()).get("cards", []))
        http.put(dispatch["resultPutUrl"], out, token)
        http.post_json(callback, {"type": "assembled", "plays": plays}, token)
        return plays
    except Exception as error:
        try:
            http.post_json(callback, {"type": "failed", "error": f"{type(error).__name__}: {error}"[:500]}, token)
        except WorkerError:
            pass
        raise
    finally:
        if own:
            shutil.rmtree(root, ignore_errors=True)


def run_split(dispatch: dict, http: Http, *, splitter=split_video, workdir: Path | None = None) -> list[dict]:
    """Find the plays in one long video and report them. The plan is `[{start, snap, end, score, green}]`, seconds
    from the start of this video; the app numbers the clips across all of a game's videos."""
    _require(dispatch, "jobId", "callbackUrl", "token", "video")
    callback, token = dispatch["callbackUrl"], dispatch["token"]
    video = dispatch["video"]
    own = workdir is None
    root = workdir or Path(tempfile.mkdtemp(prefix="film-split-"))
    try:
        source = resolve_source(video["url"], http, token, root)
        plays, series = splitter(source)
        plan = [dataclasses.asdict(p) for p in plays]
        http.post_json(
            callback,
            {"type": "split", "index": int(video["index"]), "name": str(video.get("name", "")), "duration": round(series.duration, 1), "plays": plan},
            token,
        )
        return plan
    except Exception as error:
        try:
            http.post_json(callback, {"type": "failed", "error": f"{type(error).__name__}: {error}"[:500]}, token)
        except WorkerError:
            pass
        raise
    finally:
        if own:
            shutil.rmtree(root, ignore_errors=True)


def build_cards(tracks_dir: Path, formations: Path, out: Path) -> None:
    """`scripts/tracks-to-cards.ts`, the same step `eval.game` runs."""
    subprocess.run(
        ["npx", "--yes", "jiti", "scripts/tracks-to-cards.ts", str(tracks_dir), "--formations", str(formations), "--out", str(out)],
        cwd=REPO,
        check=True,
        capture_output=True,
        timeout=600,
    )


def check_secret(header: str | None, secret: str) -> bool:
    """`Authorization: Bearer <secret>` from the app, compared without leaking timing."""
    if not secret or not header or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[len("Bearer "):].encode(), secret.encode())

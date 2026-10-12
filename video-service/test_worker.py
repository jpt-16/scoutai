"""The hosted worker (eval/worker.py, eval/worker_server.py), without a GPU or the real network.

The clip is the drawn game clip from test_autocalib and the detector is its stand-in, so a shard
really calibrates, reads the formation and follows the play; only the downloads, uploads and
callbacks are faked (a recorder), plus a small local web server for the real `Http` class.
"""

import gzip
import json
import re
import shutil
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np
import pytest

import synthfield as sf
from eval import worker
from eval.worker import Http, WorkerError, check_secret, run_assemble, run_shard
from test_autocalib import StandIn, make_game_clip
from test_split import render_game, snap_times

ROOT = Path(__file__).resolve().parent.parent


class Recorder(Http):
    """Downloads copy a local file, uploads and callbacks are written down."""

    def __init__(self, sources: dict[str, Path]):
        super().__init__(sleep=lambda s: None)
        self.sources = sources
        self.puts: dict[str, bytes] = {}
        self.posts: list[tuple[str, dict, str]] = []

    def download(self, url, dest, token=None):
        assert token, "every download carries the job's token"
        if url not in self.sources:
            raise WorkerError(f"404 {url}")
        shutil.copyfile(self.sources[url], dest)

    def put(self, url, path, token=None):
        assert token, "every upload carries the job's token"
        self.puts[url] = Path(path).read_bytes()

    def post_json(self, url, payload, token):
        self.posts.append((url, payload, token))


def blank_clip(tmp_path: Path, name: str) -> Path:
    """A grey picture with no field in it: the calibrator must say it needs a hand."""
    clip = tmp_path / name
    out = cv2.VideoWriter(str(clip), cv2.VideoWriter_fourcc(*"mp4v"), 30, (640, 360))
    for _ in range(20):
        out.write(np.full((360, 640, 3), 90, np.uint8))
    out.release()
    return clip


def shard(clips: list[dict]) -> dict:
    return {
        "type": "shard", "jobId": "job12345", "callbackUrl": "https://app.test/api/film/worker/job12345",
        "token": "tok", "options": {"tiles": 1, "region": False, "seconds": 2.0}, "clips": clips,
    }


def test_a_shard_reads_each_clip_reports_it_and_leaves_no_film_behind(tmp_path):
    good, boxes = make_game_clip(tmp_path, sf.QUAD_A, 1)
    blank = blank_clip(tmp_path, "play_04.mp4")
    http = Recorder({"https://dl/good": good, "https://dl/blank": blank})
    work = tmp_path / "work"
    results = run_shard(
        shard([
            {"index": 0, "name": "play_03.mp4", "url": "https://dl/good", "tracksPutUrl": "https://up/tracks0"},
            {"index": 1, "name": "play_04.mp4", "url": "https://dl/blank", "tracksPutUrl": "https://up/tracks1"},
            {"index": 2, "name": "play_05.mp4", "url": "https://dl/missing", "tracksPutUrl": "https://up/tracks2"},
        ]),
        StandIn(boxes), http, threads=2, workdir=work,
    )
    by_name = {r.name: r for r in results}
    assert by_name["play_03.mp4"].status == "done"
    assert (by_name["play_03.mp4"].formation, by_name["play_03.mp4"].strength) == ("trips", "right")
    assert by_name["play_04.mp4"].status == "needs_hand"
    assert by_name["play_05.mp4"].status == "failed" and "404" in by_name["play_05.mp4"].reason

    # Only the clip that worked uploaded tracks, and they are the tracker's file.
    assert list(http.puts) == ["https://up/tracks0"]
    assert "tracks" in json.loads(http.puts["https://up/tracks0"])
    # Every clip reported, with the job's own token, to the job's own callback.
    posted = {p["index"]: p for _, p, _ in http.posts}
    assert {i: p["status"] for i, p in posted.items()} == {0: "done", 1: "needs_hand", 2: "failed"}
    assert all(url.endswith("/job12345") and token == "tok" for url, _, token in http.posts)
    assert posted[0]["formation"] == "trips" and posted[0]["strength"] == "right"
    # The film itself is gone as soon as it was read (these are minors).
    assert not list((work / "clips").glob("*.mp4"))


def test_a_shard_that_made_its_own_folder_removes_it(tmp_path, monkeypatch):
    good, boxes = make_game_clip(tmp_path, sf.QUAD_A, 1)
    made: list[Path] = []
    real = worker.tempfile.mkdtemp

    def tracked(**kw):
        d = real(**kw)
        made.append(Path(d))
        return d

    monkeypatch.setattr(worker.tempfile, "mkdtemp", tracked)
    run_shard(shard([{"index": 0, "name": "play_03.mp4", "url": "u", "tracksPutUrl": "p"}]),
              StandIn(boxes), Recorder({"u": good}), threads=1)
    assert made and not made[0].exists()


@pytest.mark.parametrize("name", ["../etc/passwd", "a/b.mp4", ".hidden.mp4", ""])
def test_a_clip_name_with_a_path_in_it_is_refused(tmp_path, name):
    http = Recorder({})
    results = run_shard(shard([{"index": 0, "name": name, "url": "u", "tracksPutUrl": "p"}]), StandIn([]), http, workdir=tmp_path)
    assert results[0].status == "failed" and "bad clip name" in results[0].reason


def test_a_dispatch_missing_pieces_is_refused():
    with pytest.raises(WorkerError, match="callbackUrl"):
        run_shard({"jobId": "x", "token": "t", "clips": []}, StandIn([]), Recorder({}))


def assemble_dispatch(tmp_path):
    (tmp_path / "t1.json").write_text('{"fps": 30}')
    (tmp_path / "t2.json").write_text('{"fps": 30}')
    return {
        "type": "assemble", "jobId": "job12345", "callbackUrl": "https://app.test/cb", "token": "tok",
        "tracks": [{"name": "play_03.mp4", "url": "https://dl/t1"}, {"name": "play_04.mp4", "url": "https://dl/t2"}],
        "forms": [{"PLAY #": "3", "OFF FORM": "trips", "OFF STR": "right"}, {"PLAY #": "4", "OFF FORM": "pro", "OFF STR": ""}],
        "resultPutUrl": "https://up/game",
    }


def test_assemble_downloads_every_tracks_file_builds_the_game_and_reports(tmp_path):
    dispatch = assemble_dispatch(tmp_path)
    http = Recorder({"https://dl/t1": tmp_path / "t1.json", "https://dl/t2": tmp_path / "t2.json"})
    seen = {}

    def build(tracks_dir, formations, out):
        seen["tracks"] = sorted(p.name for p in tracks_dir.glob("*.json"))
        seen["csv"] = formations.read_text()
        out.write_text(json.dumps({"cards": [{}, {}], "fileName": "g"}))

    plays = run_assemble(dispatch, http, build=build, workdir=tmp_path / "w")
    assert plays == 2
    assert seen["tracks"] == ["play_03.json", "play_04.json"]  # named by the clip, as tracks-to-cards matches them
    assert seen["csv"].splitlines()[0] == "PLAY #,OFF FORM,OFF STR" and "3,trips,right" in seen["csv"]
    assert json.loads(http.puts["https://up/game"])["cards"] == [{}, {}]
    assert http.posts[-1][1] == {"type": "assembled", "plays": 2}


def test_assemble_that_fails_tells_the_app_and_still_raises(tmp_path):
    dispatch = assemble_dispatch(tmp_path)
    http = Recorder({"https://dl/t1": tmp_path / "t1.json", "https://dl/t2": tmp_path / "t2.json"})

    def build(*_):
        raise RuntimeError("no cards")

    with pytest.raises(RuntimeError):
        run_assemble(dispatch, http, build=build, workdir=tmp_path / "w")
    assert http.posts[-1][1]["type"] == "failed" and "no cards" in http.posts[-1][1]["error"]
    assert not http.puts


@pytest.mark.skipif(not (ROOT / "node_modules").exists() or not shutil.which("npx"), reason="needs the app's node_modules")
def test_the_real_card_builder_turns_a_shards_tracks_into_a_game(tmp_path):
    """The worker's own tracks, through the app's own tracks-to-cards, make a game file the app opens."""
    good, boxes = make_game_clip(tmp_path, sf.QUAD_A, 1)
    http = Recorder({"u": good})
    work = tmp_path / "w"
    results = run_shard(shard([{"index": 0, "name": "play_03.mp4", "url": "u", "tracksPutUrl": "p"}]),
                        StandIn(boxes), http, threads=1, workdir=work)
    assert results[0].status == "done"
    dispatch = {
        "type": "assemble", "jobId": "job12345", "callbackUrl": "cb", "token": "t",
        "tracks": [{"name": "play_03.mp4", "url": "t"}],
        "forms": [{"PLAY #": "3", "OFF FORM": "trips", "OFF STR": "right"}],
        "resultPutUrl": "g",
    }
    http2 = Recorder({"t": results[0].tracks})
    assert run_assemble(dispatch, http2, workdir=tmp_path / "a") == 1
    game = json.loads(http2.puts["g"])
    assert len(game["cards"]) == 1 and game["cards"][0]["formationKey"] == "trips"


def test_the_shared_detector_serializes_calls_and_reads_other_attributes_through():
    inside, worst = [0], [0]

    class Slow:
        device = "cuda"

        def people(self, frame, tiles):
            inside[0] += 1
            worst[0] = max(worst[0], inside[0])
            threading.Event().wait(0.01)
            inside[0] -= 1
            return []

    shared = worker.SharedDetector(Slow())
    threads = [threading.Thread(target=lambda: [shared.people(None, 1) for _ in range(5)]) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert worst[0] == 1 and shared.device == "cuda"


def test_the_secret_check():
    assert check_secret("Bearer s3cret", "s3cret")
    assert not check_secret("Bearer nope", "s3cret")
    assert not check_secret(None, "s3cret")
    assert not check_secret("s3cret", "s3cret")
    assert not check_secret("Bearer ", "")  # no secret configured: nobody gets in


class Handler(BaseHTTPRequestHandler):
    log: list = []
    fail_first = {"/flaky": 1}

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/missing":
            self.send_response(404)
            self.end_headers()
            return
        if self.path == "/flaky" and Handler.fail_first["/flaky"] > 0:
            Handler.fail_first["/flaky"] -= 1
            self.send_response(503)
            self.end_headers()
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"film bytes")

    def do_PUT(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        Handler.log.append(("PUT", self.path, gzip.decompress(body), self.headers["Content-Type"], self.headers["x-film-token"]))
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        Handler.log.append(("POST", self.path, json.loads(body), self.headers["x-film-token"]))
        self.send_response(200)
        self.end_headers()


@pytest.fixture
def server():
    srv = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    Handler.log.clear()
    Handler.fail_first["/flaky"] = 1
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def test_the_real_http_downloads_uploads_and_posts_with_the_job_token(server, tmp_path):
    http = Http(sleep=lambda s: None)
    http.download(f"{server}/clip", tmp_path / "c.mp4", "tok123")
    assert (tmp_path / "c.mp4").read_bytes() == b"film bytes"
    (tmp_path / "t.json").write_text("{}")
    http.put(f"{server}/up", tmp_path / "t.json", "tok123")
    http.post_json(f"{server}/cb", {"type": "clip"}, "tok123")
    # The upload arrives gzipped (the app's functions take 4.5 MB a request) and every request carries the token.
    assert Handler.log == [("PUT", "/up", b"{}", "application/gzip", "tok123"), ("POST", "/cb", {"type": "clip"}, "tok123")]


def test_the_real_http_retries_a_server_error_but_not_a_refusal(server, tmp_path):
    http = Http(sleep=lambda s: None)
    http.download(f"{server}/flaky", tmp_path / "x")  # 503 once, then fine
    assert (tmp_path / "x").read_bytes() == b"film bytes"
    with pytest.raises(WorkerError, match="404"):
        http.download(f"{server}/missing", tmp_path / "y")


def test_the_server_only_accepts_a_signed_well_formed_dispatch(monkeypatch):
    from fastapi.testclient import TestClient

    from eval import worker_server

    monkeypatch.setenv("FILM_WORKER_SECRET", "s3cret")
    submitted = []
    monkeypatch.setattr(worker_server._pool, "submit", lambda fn, d: submitted.append(d))
    client = TestClient(worker_server.app)
    good = {"type": "shard", "jobId": "j", "callbackUrl": "c", "token": "t", "clips": []}
    ok = {"authorization": "Bearer s3cret"}
    assert client.post("/jobs", json=good).status_code == 401
    assert client.post("/jobs", json=good, headers={"authorization": "Bearer wrong"}).status_code == 401
    assert client.post("/jobs", json={"type": "nope"}, headers=ok).status_code == 400
    assert client.post("/jobs", json={"type": "shard", "jobId": "j"}, headers=ok).status_code == 400
    assert client.post("/jobs", content=b"not json", headers=ok).status_code == 400
    assert not submitted
    r = client.post("/jobs", json=good, headers=ok)
    assert r.status_code == 202 and submitted == [good]
    assert client.get("/health").json()["ok"] is True


# ------------------------------------------------------------------ a long video, read over HTTP by range


@pytest.fixture(scope="module")
def long_video(tmp_path_factory) -> Path:
    path = tmp_path_factory.mktemp("long") / "half.mp4"
    render_game(path)
    return path


class RangeServer:
    """Serves one file with HTTP Range support (what Blob's CDN does and what OpenCV's reader asks for)."""

    def __init__(self, path: Path):
        data = path.read_bytes()
        self.ranges: list[str | None] = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                if not self.path.startswith("/video.mp4"):
                    self.send_response(404)
                    self.end_headers()
                    return
                rng = self.headers.get("Range")
                outer.ranges.append(rng)
                a, b = 0, len(data) - 1
                if rng and (m := re.match(r"bytes=(\d+)-(\d*)", rng)):
                    a = int(m.group(1))
                    b = min(int(m.group(2)) if m.group(2) else b, len(data) - 1)
                    self.send_response(206)
                    self.send_header("Content-Range", f"bytes {a}-{b}/{len(data)}")
                else:
                    self.send_response(200)
                self.send_header("Content-Length", str(b - a + 1))
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Type", "video/mp4")
                self.end_headers()
                try:
                    self.wfile.write(data[a : b + 1])
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"
        self.size = len(data)

    def close(self):
        self.server.shutdown()


@pytest.fixture
def range_server(long_video):
    srv = RangeServer(long_video)
    yield srv
    srv.close()


def test_a_split_job_finds_the_plays_in_a_long_video_read_by_range_and_reports_the_plan(range_server, tmp_path):
    http = Recorder({})
    plan = worker.run_split(
        {"type": "split", "jobId": "job12345", "callbackUrl": "https://app.test/cb", "token": "tok",
         "video": {"index": 0, "name": "first_half.mp4", "url": f"{range_server.base}/video.mp4?t=abc"}},
        http, workdir=tmp_path,
    )
    truth = snap_times()
    assert len(plan) == len(truth)
    assert all(abs(p["snap"] - t) <= 0.9 for p, t in zip(plan, truth))
    (url, report, token) = http.posts[-1]
    assert (url, token) == ("https://app.test/cb", "tok")
    assert report["type"] == "split" and report["index"] == 0 and report["name"] == "first_half.mp4"
    assert report["plays"] == plan and report["duration"] > 100
    assert any(r for r in range_server.ranges)  # it asked for byte ranges: the whole file was not simply downloaded first


def test_a_split_that_cannot_read_the_video_tells_the_app(tmp_path):
    http = Recorder({})
    with pytest.raises(Exception):
        worker.run_split(
            {"type": "split", "jobId": "job12345", "callbackUrl": "cb", "token": "tok", "video": {"index": 0, "name": "x.mp4", "url": "http://127.0.0.1:9/nope.mp4"}},
            http, workdir=tmp_path,
        )
    assert http.posts and http.posts[-1][1]["type"] == "failed"


def test_a_video_the_reader_cannot_open_over_http_is_downloaded_once_instead(long_video, tmp_path, range_server):
    broken = f"{range_server.base}/missing.mp4?t=abc"  # 404 to OpenCV
    http = Recorder({broken: long_video})
    source = worker.resolve_source(broken, http, "tok", tmp_path)
    assert Path(source).exists() and source != broken
    assert worker.resolve_source(broken, http, "tok", tmp_path) == source  # not downloaded twice


def test_a_shard_cuts_each_clip_out_of_the_long_video_and_removes_it_after(range_server, tmp_path, monkeypatch):
    frames: dict[str, int] = {}

    def stub(clip, detector, tracks_dir, debug_dir, **kw):
        import cv2

        cap = cv2.VideoCapture(str(clip))
        frames[clip.name] = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()
        out = tracks_dir / f"{clip.stem}.json"
        out.write_text("{}")
        return worker.ClipResult(clip.name, "done", formation="trips", strength="right", tracks=out)

    monkeypatch.setattr(worker, "process_clip", stub)
    url = f"{range_server.base}/video.mp4?t=abc"
    truth = snap_times()
    http = Recorder({})
    work = tmp_path / "w"
    results = run_shard(
        shard([
            {"index": 0, "name": "play_001.mp4", "source": {"url": url, "start": truth[1] - 3, "end": truth[1] + 8}, "tracksPutUrl": "p0"},
            {"index": 1, "name": "play_002.mp4", "source": {"url": url, "start": 4000.0, "end": 4010.0}, "tracksPutUrl": "p1"},
        ]),
        None, http, threads=1, workdir=work,
    )
    by = {r.name: r for r in results}
    assert by["play_001.mp4"].status == "done" and frames["play_001.mp4"] == pytest.approx(11 * 30, abs=20)
    assert by["play_002.mp4"].status == "failed" and "nothing could be cut" in by["play_002.mp4"].reason  # past the end of the film
    assert list(http.puts) == ["p0"]
    assert not list((work / "clips").glob("*.mp4"))


def test_the_server_accepts_a_split_dispatch_and_refuses_one_without_a_video(monkeypatch):
    from fastapi.testclient import TestClient

    from eval import worker_server

    monkeypatch.setenv("FILM_WORKER_SECRET", "s3cret")
    submitted = []
    monkeypatch.setattr(worker_server._pool, "submit", lambda fn, d: submitted.append(d))
    client = TestClient(worker_server.app)
    ok = {"authorization": "Bearer s3cret"}
    good = {"type": "split", "jobId": "j", "callbackUrl": "c", "token": "t", "video": {"index": 0, "name": "a.mp4", "url": "u"}}
    assert client.post("/jobs", json={k: v for k, v in good.items() if k != "video"}, headers=ok).status_code == 400
    assert client.post("/jobs", json=good, headers=ok).status_code == 202 and submitted == [good]

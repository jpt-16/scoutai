import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { TIER_LIMITS } from "../usageLimits";
import { MemoryStorage, RecordingDispatcher } from "./memoryStorage";
import { CLIP_RETENTION_DAYS, STUCK_JOB_HOURS, paths, teamKey, verifyWorkerToken, workerToken, type FilmJob } from "./jobs";
import {
  FilmError,
  authorizeUpload,
  cleanup,
  createJob,
  deleteJob,
  getView,
  handleEvent,
  listViews,
  openForWorker,
  openGame,
  openVideoForWorker,
  renameJob,
  saveGameCards,
  startJob,
  storeResult,
  storeTracks,
  type FilmContext,
} from "./service";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const OWNER = "org_pilot";
const SECRET = "s3cret";
const limits = TIER_LIMITS.paid.film;

let storage: MemoryStorage;
let dispatcher: RecordingDispatcher;
let clock: number;
let ctx: FilmContext;

beforeEach(() => {
  storage = new MemoryStorage();
  dispatcher = new RecordingDispatcher();
  clock = Date.parse("2026-10-20T12:00:00Z");
  storage.now = () => new Date(clock);
  ctx = { storage, dispatcher, secret: SECRET, origin: "https://app.test", now: () => clock };
});

const files = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `play_${i + 1}.mp4`, size: 4000 + i }));

/** Create a game, upload every clip, and start it. */
async function startGame(n = 3, owner = OWNER) {
  const { job, uploads } = await createJob(ctx, owner, limits, files(n));
  for (const u of uploads) storage.addClip(u.pathname, 4000 + u.index);
  const started = await startJob(ctx, owner, job.id);
  return { id: job.id, uploads, started };
}

const clipEvent = (index: number, status = "done", extra: object = {}) => ({
  type: "clip" as const, index, name: `play_${index + 1}.mp4`, status, formation: "trips", strength: "right", seconds: 41, ...extra,
});

const gz = (value: unknown) => gzipSync(Buffer.from(JSON.stringify(value)));

describe("creating a game and uploading its clips", () => {
  it("hands back one upload path per clip, inside this staff's own folder", async () => {
    const { job, uploads } = await createJob(ctx, OWNER, limits, files(3));
    expect(job).toMatchObject({ stage: "uploading", total: 3 });
    expect(uploads).toHaveLength(3);
    for (const u of uploads) expect(u.pathname.startsWith(`film/${teamKey(OWNER)}/${job.id}/clips/${u.index}/`)).toBe(true);
    expect((await listViews(ctx, OWNER)).map((v) => v.id)).toEqual([job.id]);
  });

  it("turns away a game over the staff's limits with a plain message", async () => {
    await createJob(ctx, OWNER, TIER_LIMITS.demo.film, files(2));
    await expect(createJob(ctx, OWNER, TIER_LIMITS.demo.film, files(2))).rejects.toMatchObject({ status: 429, message: /already has 1 game/ });
    await expect(createJob(ctx, "org_other", limits, [{ name: "x.avi", size: 5 }])).rejects.toBeInstanceOf(FilmError);
  });

  it("lets the browser upload exactly the paths it was given, while the game waits for them", async () => {
    const { job, uploads } = await createJob(ctx, OWNER, limits, files(2));
    expect(await authorizeUpload(ctx, OWNER, uploads[0].pathname)).toEqual({ maxBytes: 4000 });
    // another staff, another index, another name, a path outside film/: all refused
    await expect(authorizeUpload(ctx, "org_other", uploads[0].pathname)).rejects.toMatchObject({ status: 403 });
    await expect(authorizeUpload(ctx, OWNER, paths.clip(teamKey(OWNER), job.id, 5, "play_1.mp4"))).rejects.toMatchObject({ status: 403 });
    await expect(authorizeUpload(ctx, OWNER, paths.clip(teamKey(OWNER), job.id, 0, "other.mp4"))).rejects.toMatchObject({ status: 403 });
    await expect(authorizeUpload(ctx, OWNER, "clips/anything.mp4")).rejects.toMatchObject({ status: 403 });
  });

  it("stops accepting uploads once the game has started", async () => {
    const { id, uploads } = await startGame(2);
    expect(id).toBeTruthy();
    await expect(authorizeUpload(ctx, OWNER, uploads[0].pathname)).rejects.toMatchObject({ status: 403 });
  });
});

describe("starting", () => {
  it("won't start while a clip is missing or came up short, and says which", async () => {
    const { job, uploads } = await createJob(ctx, OWNER, limits, files(3));
    storage.addClip(uploads[0].pathname, 4000);
    storage.addClip(uploads[1].pathname, 17); // wrong size: it didn't finish
    await expect(startJob(ctx, OWNER, job.id)).rejects.toMatchObject({ status: 409, message: /2 clips didn't finish uploading \(play_2.mp4, play_3.mp4\)/ });
    expect(dispatcher.sent).toEqual([]);
  });

  it("says so, and changes nothing, when film processing isn't switched on", async () => {
    dispatcher.on = false;
    const { job, uploads } = await createJob(ctx, OWNER, limits, files(1));
    storage.addClip(uploads[0].pathname, 4000);
    await expect(startJob(ctx, OWNER, job.id)).rejects.toMatchObject({ status: 501, code: "worker_off" });
    expect((await getView(ctx, OWNER, job.id)).stage).toBe("uploading");
  });

  it("sends the clips to the worker in shards, each with its own download and upload address and the job's token", async () => {
    const { id, started } = await startGame(8);
    expect(started.stage).toBe("reading");
    expect(dispatcher.sent).toHaveLength(2); // 6 + 2
    const [first, second] = dispatcher.sent as { type: string; jobId: string; callbackUrl: string; token: string; clips: { index: number; name: string; url: string; tracksPutUrl: string }[] }[];
    expect(first.clips.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(second.clips.map((c) => c.index)).toEqual([6, 7]);
    const team = teamKey(OWNER);
    expect(first).toMatchObject({ type: "shard", jobId: id, callbackUrl: `https://app.test/api/film/worker/${team}/${id}` });
    expect(first.clips[2]).toMatchObject({
      url: `https://app.test/api/film/worker/${team}/${id}/clip/2`,
      tracksPutUrl: `https://app.test/api/film/worker/${team}/${id}/tracks/2`,
    });
    expect(verifyWorkerToken(SECRET, team, id, first.token)).toBe(true);
    expect(first.token).toBe(workerToken(SECRET, team, id));
  });

  it("marks the game failed, with a reason, when the worker can't be reached", async () => {
    dispatcher.fail = new FilmError(502, "worker_down", "The film analyzer didn't answer.");
    const { started } = await startGame(2);
    expect(started).toMatchObject({ stage: "failed", error: "The film analyzer didn't answer." });
  });

  it("can't be started twice", async () => {
    const { id } = await startGame(2);
    await expect(startJob(ctx, OWNER, id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("the worker reporting", () => {
  it("counts clips as they come in", async () => {
    const { id } = await startGame(3);
    const team = teamKey(OWNER);
    expect(await handleEvent(ctx, team, id, clipEvent(0))).toBe("stored");
    expect(await handleEvent(ctx, team, id, clipEvent(1, "needs_hand", { reason: "only 2 yard lines", formation: "" }))).toBe("stored");
    const view = await getView(ctx, OWNER, id);
    expect(view).toMatchObject({ stage: "reading", reported: 2, read: 1, needsHand: [{ name: "play_2.mp4", reason: "only 2 yard lines" }] });
  });

  it("ignores reports it can't trust: a wrong name, a made-up outcome, another clip's index, a game that isn't running", async () => {
    const { id } = await startGame(2);
    const team = teamKey(OWNER);
    expect(await handleEvent(ctx, team, id, { ...clipEvent(0), name: "other.mp4" })).toBe("ignored");
    expect(await handleEvent(ctx, team, id, clipEvent(0, "great"))).toBe("ignored");
    expect(await handleEvent(ctx, team, id, clipEvent(9))).toBe("ignored");
    expect(await handleEvent(ctx, team, "0".repeat(18), clipEvent(0))).toBe("ignored");
    expect((await getView(ctx, OWNER, id)).reported).toBe(0);
  });

  it("starts the assemble exactly once, when the last clip reports, with only the clips that were read", async () => {
    const { id } = await startGame(3);
    const team = teamKey(OWNER);
    dispatcher.sent.length = 0;
    await handleEvent(ctx, team, id, clipEvent(0, "done", { formation: "trips", strength: "right" }));
    await handleEvent(ctx, team, id, clipEvent(1, "needs_hand", { formation: "" }));
    expect(dispatcher.sent).toEqual([]);
    expect(await handleEvent(ctx, team, id, clipEvent(2, "done", { formation: "pro", strength: "" }))).toBe("assembling");
    expect(dispatcher.sent).toHaveLength(1);
    expect(dispatcher.sent[0]).toMatchObject({
      type: "assemble",
      jobId: id,
      resultPutUrl: `https://app.test/api/film/worker/${team}/${id}/result`,
      tracks: [
        { name: "play_1.mp4", url: `https://app.test/api/film/worker/${team}/${id}/tracks/0` },
        { name: "play_3.mp4", url: `https://app.test/api/film/worker/${team}/${id}/tracks/2` },
      ],
      forms: [
        { "PLAY #": "1", "OFF FORM": "trips", "OFF STR": "right" },
        { "PLAY #": "3", "OFF FORM": "pro", "OFF STR": "" },
      ],
    });
    // A repeated last report (the worker retrying a callback) doesn't start a second assemble.
    expect(await handleEvent(ctx, team, id, clipEvent(2, "done", { formation: "pro" }))).toBe("stored");
    expect(dispatcher.sent).toHaveLength(1);
    expect((await getView(ctx, OWNER, id)).stage).toBe("building");
  });

  it("heals a game whose last two reports landed at once and each missed the other", async () => {
    const { id } = await startGame(2);
    const team = teamKey(OWNER);
    dispatcher.sent.length = 0;
    // Both reports were written, but neither handler started the assemble (as if each listed before the other's landed).
    for (const i of [0, 1]) await storage.putJson(paths.status(team, id, i, "done"), { index: i, name: `play_${i + 1}.mp4`, status: "done", reason: "", formation: "trips", strength: "right", seconds: 1, at: "" });
    expect(dispatcher.sent).toEqual([]);
    // The coach's screen asking for the game's status is what notices.
    expect((await getView(ctx, OWNER, id)).stage).toBe("building");
    expect(dispatcher.sent).toHaveLength(1);
    await getView(ctx, OWNER, id); // and polling again doesn't repeat it
    expect(dispatcher.sent).toHaveLength(1);
  });

  it("fails the game when no clip could be read", async () => {
    const { id } = await startGame(2);
    const team = teamKey(OWNER);
    await handleEvent(ctx, team, id, clipEvent(0, "needs_hand"));
    expect(await handleEvent(ctx, team, id, clipEvent(1, "failed", { reason: "boom" }))).toBe("failed");
    expect(await getView(ctx, OWNER, id)).toMatchObject({ stage: "failed", error: /None of the clips/ });
    expect(dispatcher.sent.filter((d) => d.type === "assemble")).toEqual([]);
  });

  it("fails the game, with a reason, when the assemble can't be sent", async () => {
    const { id } = await startGame(1);
    dispatcher.fail = new FilmError(502, "worker_down", "The film analyzer didn't answer.");
    expect(await handleEvent(ctx, teamKey(OWNER), id, clipEvent(0))).toBe("failed");
    expect((await getView(ctx, OWNER, id)).error).toBe("The film analyzer didn't answer.");
  });

  it("turns the game ready when the cards arrive, and the coach can open it", async () => {
    const { id } = await startGame(1);
    const team = teamKey(OWNER);
    await handleEvent(ctx, team, id, clipEvent(0));
    expect(await storeResult(ctx, team, id, gz({ fileName: "g", cards: [{ id: "a" }, { id: "b" }] }))).toBe(2);
    expect(await handleEvent(ctx, team, id, { type: "assembled", plays: 2 })).toBe("ready");
    expect(await getView(ctx, OWNER, id)).toMatchObject({ stage: "ready", plays: 2 });
    const game = await openGame(ctx, OWNER, id);
    expect(JSON.parse(await new Response(game.stream).text()).cards).toHaveLength(2);
  });

  it("won't call a game ready if its cards never arrived", async () => {
    const { id } = await startGame(1);
    const team = teamKey(OWNER);
    await handleEvent(ctx, team, id, clipEvent(0));
    expect(await handleEvent(ctx, team, id, { type: "assembled", plays: 2 })).toBe("failed");
    await expect(openGame(ctx, OWNER, id)).rejects.toMatchObject({ status: 409 });
  });

  it("records the worker's own failure", async () => {
    const { id } = await startGame(1);
    expect(await handleEvent(ctx, teamKey(OWNER), id, { type: "failed", error: "out of memory" })).toBe("failed");
    expect((await getView(ctx, OWNER, id)).error).toBe("out of memory");
  });
});

describe("what the worker uploads and downloads, through the app", () => {
  it("stores a clip's tracks gzipped-in, plain-out, only for a game that is running and a clip that exists", async () => {
    const { id } = await startGame(2);
    const team = teamKey(OWNER);
    await storeTracks(ctx, team, id, 1, gz({ tracks: [] }));
    expect(await storage.getJson(paths.tracks(team, id, 1))).toEqual({ tracks: [] });
    await expect(storeTracks(ctx, team, id, 7, gz({}))).rejects.toMatchObject({ status: 404 });
    await expect(storeTracks(ctx, team, id, 0, Buffer.from("not gzip"))).rejects.toMatchObject({ status: 400 });
    await expect(storeTracks(ctx, team, id, 0, gzipSync(Buffer.from("not json")))).rejects.toMatchObject({ status: 400 });
    await expect(storeTracks(ctx, team, "0".repeat(18), 0, gz({}))).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a game file with no cards", async () => {
    const { id } = await startGame(1);
    await expect(storeResult(ctx, teamKey(OWNER), id, gz({ cards: [] }))).rejects.toMatchObject({ status: 400 });
    await expect(storeResult(ctx, teamKey(OWNER), id, gz({ nope: 1 }))).rejects.toMatchObject({ status: 400 });
  });

  it("serves the clip and its tracks to the worker while the game is running, and not after", async () => {
    const { id } = await startGame(1);
    const team = teamKey(OWNER);
    const clip = await openForWorker(ctx, team, id, "clip", 0);
    expect(clip.size).toBe(4000);
    await expect(openForWorker(ctx, team, id, "clip", 3)).rejects.toMatchObject({ status: 404 });
    await expect(openForWorker(ctx, team, id, "tracks", 0)).rejects.toMatchObject({ status: 404 }); // not stored yet
    await storeTracks(ctx, team, id, 0, gz({ ok: 1 }));
    expect((await openForWorker(ctx, team, id, "tracks", 0)).contentType).toBe("application/json");
    await handleEvent(ctx, team, id, { type: "failed", error: "x" });
    await expect(openForWorker(ctx, team, id, "clip", 0)).rejects.toMatchObject({ status: 409 });
  });
});

describe("one staff can't see another's games", () => {
  it("answers 'not in your library' for status, game, delete and film listing", async () => {
    const { id } = await startGame(1);
    await expect(getView(ctx, "org_other", id)).rejects.toMatchObject({ status: 404 });
    await expect(openGame(ctx, "org_other", id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteJob(ctx, "org_other", id)).rejects.toMatchObject({ status: 404 });
    expect(await listViews(ctx, "org_other")).toEqual([]);
    expect(await listViews(ctx, OWNER)).toHaveLength(1);
  });
});

describe("deleting a game now", () => {
  it("removes the film, the tracks, the reports, the game and the record", async () => {
    const { id } = await startGame(2);
    const team = teamKey(OWNER);
    await handleEvent(ctx, team, id, clipEvent(0));
    await storeTracks(ctx, team, id, 0, gz({ a: 1 }));
    await deleteJob(ctx, OWNER, id);
    expect([...storage.objects.keys()]).toEqual([]);
  });
});

describe("the daily sweep", () => {
  async function finishedGame() {
    const { id } = await startGame(2);
    const team = teamKey(OWNER);
    await handleEvent(ctx, team, id, clipEvent(0));
    await handleEvent(ctx, team, id, clipEvent(1));
    await storeTracks(ctx, team, id, 0, gz({ a: 1 }));
    await storeResult(ctx, team, id, gz({ cards: [{}] }));
    await handleEvent(ctx, team, id, { type: "assembled", plays: 1 });
    return { id, team };
  }

  it("deletes a finished game's film after the retention and keeps the game", async () => {
    const { id, team } = await finishedGame();
    clock += (CLIP_RETENTION_DAYS - 1) * DAY;
    expect(await cleanup(ctx)).toMatchObject({ checked: 1, filmDeleted: 0 });
    expect([...storage.objects.keys()].some((k) => k.includes("/clips/"))).toBe(true);

    clock += 2 * DAY;
    expect(await cleanup(ctx)).toMatchObject({ filmDeleted: 1 });
    const left = [...storage.objects.keys()];
    expect(left.some((k) => k.includes("/clips/") || k.includes("/tracks/") || k.includes("/status/"))).toBe(false);
    expect(left).toContain(paths.game(team, id));
    const view = await getView(ctx, OWNER, id);
    expect(view.stage).toBe("ready");
    expect(view.filmDeletedAt).not.toBeNull();
    expect((await openGame(ctx, OWNER, id)).size).toBeGreaterThan(0);

    expect(await cleanup(ctx)).toMatchObject({ filmDeleted: 0 }); // once
  });

  it("removes an upload nobody finished, all of it", async () => {
    const { job, uploads } = await createJob(ctx, OWNER, limits, files(2));
    storage.addClip(uploads[0].pathname, 4000);
    clock += 3 * DAY;
    expect(await cleanup(ctx)).toMatchObject({ removed: 1 });
    expect([...storage.objects.keys()]).toEqual([]);
    expect(job.id).toBeTruthy();
  });

  it("marks a game the worker never finished as failed, so it stops holding a slot", async () => {
    const { id } = await startGame(2);
    clock += (STUCK_JOB_HOURS + 1) * HOUR;
    expect(await cleanup(ctx)).toMatchObject({ markedStuck: 1 });
    expect(await getView(ctx, OWNER, id)).toMatchObject({ stage: "failed", error: /didn't finish/ });
    const record = await storage.getJson<FilmJob>(paths.job(teamKey(OWNER), id));
    expect(record?.state).toBe("failed");
  });
});


describe("a whole game's video", () => {
  const GB = 1024 * 1024 * 1024;
  const halves = [{ name: "first_half.mp4", size: 2 * GB }, { name: "second_half.mp4", size: 3 * GB }];

  // The memory store holds small stand-ins, so the tests that put videos in it declare small sizes.
  const small = [{ name: "first_half.mp4", size: 8000 }, { name: "second_half.mp4", size: 8001 }];
  const splitEvent = (index: number, plays: object[], duration = 3000) => ({ type: "split" as const, index, name: `v${index}.mp4`, duration, plays });
  const p = (start: number, snap: number, end: number) => ({ start, snap, end, score: 0.9, green: 0.6 });

  it("hands back an upload path per video, under videos/, and signs only those", async () => {
    const { job, uploads } = await createJob(ctx, OWNER, limits, halves, "video");
    expect(job).toMatchObject({ stage: "uploading", kind: "video", videos: 2, total: 0 });
    expect(uploads.map((u) => u.pathname)).toEqual([
      `film/${teamKey(OWNER)}/${job.id}/videos/0/first_half.mp4`,
      `film/${teamKey(OWNER)}/${job.id}/videos/1/second_half.mp4`,
    ]);
    expect(await authorizeUpload(ctx, OWNER, uploads[1].pathname)).toEqual({ maxBytes: 3 * GB });
    await expect(authorizeUpload(ctx, "org_other", uploads[0].pathname)).rejects.toMatchObject({ status: 403 });
    await expect(authorizeUpload(ctx, OWNER, paths.video(teamKey(OWNER), job.id, 0, "other.mp4"))).rejects.toMatchObject({ status: 403 });
    // a clip path in a video game is not one of its files
    await expect(authorizeUpload(ctx, OWNER, paths.clip(teamKey(OWNER), job.id, 0, "first_half.mp4"))).rejects.toMatchObject({ status: 403 });
  });

  it("turns away a video game over the limits", async () => {
    await expect(createJob(ctx, OWNER, limits, [{ name: "x.avi", size: 5 }], "video")).rejects.toMatchObject({ status: 429, message: /isn't a video/ });
    await expect(createJob(ctx, OWNER, limits, [{ name: "big.mp4", size: 100 * GB }], "video")).rejects.toMatchObject({ message: /halves/ });
  });

  it("won't start until every video has landed whole", async () => {
    const { job, uploads } = await createJob(ctx, OWNER, limits, small, "video");
    storage.addClip(uploads[0].pathname, 8000);
    storage.addClip(uploads[1].pathname, 5);
    await expect(startJob(ctx, OWNER, job.id)).rejects.toMatchObject({ status: 409, message: /second_half.mp4 didn't finish/ });
    expect(dispatcher.sent).toEqual([]);
  });

  it("starts by asking the worker to split each video, with the video's own address and the job's token", async () => {
    const { job, uploads } = await createJob(ctx, OWNER, limits, small, "video");
    for (const u of uploads) storage.addClip(u.pathname, small[u.index].size);
    const view = await startJob(ctx, OWNER, job.id);
    expect(view.stage).toBe("splitting");
    const team = teamKey(OWNER);
    const token = workerToken(SECRET, team, job.id);
    expect(dispatcher.sent).toEqual([
      { type: "split", jobId: job.id, callbackUrl: `https://app.test/api/film/worker/${team}/${job.id}`, token, video: { index: 0, name: "first_half.mp4", url: `https://app.test/api/film/worker/${team}/${job.id}/video/0?t=${token}` } },
      { type: "split", jobId: job.id, callbackUrl: `https://app.test/api/film/worker/${team}/${job.id}`, token, video: { index: 1, name: "second_half.mp4", url: `https://app.test/api/film/worker/${team}/${job.id}/video/1?t=${token}` } },
    ]);
  });

  async function started() {
    const { job, uploads } = await createJob(ctx, OWNER, limits, small, "video");
    for (const u of uploads) storage.addClip(u.pathname, small[u.index].size);
    await startJob(ctx, OWNER, job.id);
    dispatcher.sent.length = 0;
    return { id: job.id, team: teamKey(OWNER) };
  }

  it("waits for every video to be split, then numbers the plays across them and sends them as shards cut from the video", async () => {
    const { id, team } = await started();
    // the second video reports first: numbering still follows the video order
    expect(await handleEvent(ctx, team, id, splitEvent(1, [p(5, 8, 17)]))).toBe("stored");
    expect(dispatcher.sent).toEqual([]);
    expect((await getView(ctx, OWNER, id)).stage).toBe("splitting");
    expect(await handleEvent(ctx, team, id, splitEvent(0, [p(30, 33, 42), p(90, 93, 102)]))).toBe("planned");

    const view = await getView(ctx, OWNER, id);
    expect(view).toMatchObject({ stage: "reading", total: 3, reported: 0 });
    expect(dispatcher.sent).toHaveLength(1);
    const shard = dispatcher.sent[0] as { type: string; clips: { index: number; name: string; source?: { url: string; start: number; end: number }; url?: string; tracksPutUrl: string }[] };
    expect(shard.type).toBe("shard");
    const token = workerToken(SECRET, team, id);
    expect(shard.clips.map((c) => [c.index, c.name, c.source?.start, c.source?.end, c.url])).toEqual([
      [0, "play_001.mp4", 30, 42, undefined],
      [1, "play_002.mp4", 90, 102, undefined],
      [2, "play_003.mp4", 5, 17, undefined],
    ]);
    expect(shard.clips[0].source?.url).toBe(`https://app.test/api/film/worker/${team}/${id}/video/0?t=${token}`);
    expect(shard.clips[2].source?.url).toBe(`https://app.test/api/film/worker/${team}/${id}/video/1?t=${token}`);
    expect(shard.clips[0].tracksPutUrl).toBe(`https://app.test/api/film/worker/${team}/${id}/tracks/0`);
  });

  it("plans once, even if a split is reported again", async () => {
    const { id, team } = await started();
    await handleEvent(ctx, team, id, splitEvent(0, [p(30, 33, 42)]));
    await handleEvent(ctx, team, id, splitEvent(1, [p(5, 8, 17)]));
    expect(dispatcher.sent).toHaveLength(1);
    expect(await handleEvent(ctx, team, id, splitEvent(1, [p(5, 8, 17)]))).toBe("ignored"); // clips are set now
    expect(dispatcher.sent).toHaveLength(1);
  });

  it("heals a game whose last two split reports landed together, from the status poll", async () => {
    const { id, team } = await started();
    await storage.putJson(paths.split(team, id, 0), { index: 0, duration: 3000, plays: [{ start: 30, snap: 33, end: 42, score: 1 }] });
    await storage.putJson(paths.split(team, id, 1), { index: 1, duration: 3000, plays: [{ start: 5, snap: 8, end: 17, score: 1 }] });
    expect(dispatcher.sent).toEqual([]);
    expect((await getView(ctx, OWNER, id)).stage).toBe("reading");
    expect(dispatcher.sent).toHaveLength(1);
    await getView(ctx, OWNER, id);
    expect(dispatcher.sent).toHaveLength(1);
  });

  it("ignores a split report that is for no video of this game, or isn't a report", async () => {
    const { id, team } = await started();
    expect(await handleEvent(ctx, team, id, splitEvent(5, [p(30, 33, 42)]))).toBe("ignored");
    expect(await handleEvent(ctx, team, id, { type: "split", index: 0, duration: -1, plays: [] })).toBe("ignored");
    expect(await handleEvent(ctx, team, id, { type: "split", index: 0, duration: 100, plays: "x" })).toBe("ignored");
    expect((await getView(ctx, OWNER, id)).stage).toBe("splitting");
  });

  it("fails the game, with a reason the coach can act on, when no plays were found or there are too many", async () => {
    const none = await started();
    await handleEvent(ctx, none.team, none.id, splitEvent(0, []));
    await handleEvent(ctx, none.team, none.id, splitEvent(1, []));
    expect(await getView(ctx, OWNER, none.id)).toMatchObject({ stage: "failed", error: /No plays were found/ });

    const many = await started();
    const tooMany = Array.from({ length: limits.maxPlays + 1 }, (_, i) => p(i * 20, i * 20 + 3, i * 20 + 12));
    await handleEvent(ctx, many.team, many.id, splitEvent(0, tooMany, 100_000));
    await handleEvent(ctx, many.team, many.id, splitEvent(1, []));
    expect(await getView(ctx, OWNER, many.id)).toMatchObject({ stage: "failed", error: new RegExp(`${limits.maxPlays + 1} plays, more than the ${limits.maxPlays}`) });
    expect(dispatcher.sent).toEqual([]);
  });

  it("then reads, assembles and finishes like any other game", async () => {
    const { id, team } = await started();
    await handleEvent(ctx, team, id, splitEvent(0, [p(30, 33, 42), p(90, 93, 102)]));
    await handleEvent(ctx, team, id, splitEvent(1, []));
    dispatcher.sent.length = 0;
    await handleEvent(ctx, team, id, clipEvent(0, "done", { name: "play_001.mp4", formation: "trips", strength: "right" }));
    expect(await handleEvent(ctx, team, id, clipEvent(1, "done", { name: "play_002.mp4", formation: "pro", strength: "" }))).toBe("assembling");
    expect(dispatcher.sent[0]).toMatchObject({
      type: "assemble",
      forms: [
        { "PLAY #": "1", "OFF FORM": "trips", "OFF STR": "right" },
        { "PLAY #": "2", "OFF FORM": "pro", "OFF STR": "" },
      ],
    });
    await storeResult(ctx, team, id, gz({ cards: [{}, {}] }));
    expect(await handleEvent(ctx, team, id, { type: "assembled", plays: 2 })).toBe("ready");
    expect(await getView(ctx, OWNER, id)).toMatchObject({ stage: "ready", plays: 2, kind: "video" });
  });

  it("recognizes two angles of one game and reads only the video marked as the press box", async () => {
    const files = [{ name: "press_box.mp4", size: 8000, read: true }, { name: "end_zone.mp4", size: 8001, read: false }];
    const { job, uploads } = await createJob(ctx, OWNER, limits, files, "video");
    for (const u of uploads) storage.addClip(u.pathname, files[u.index].size);
    await startJob(ctx, OWNER, job.id);
    const id = job.id;
    const team = teamKey(OWNER);
    dispatcher.sent.length = 0;

    const press = Array.from({ length: 6 }, (_, i) => p(60 + i * 40, 63 + i * 40, 72 + i * 40));
    const endZone = press.map((x) => ({ ...x, start: x.start - 25, snap: x.snap - 25 + 0.4, end: x.end - 25 }));
    await handleEvent(ctx, team, id, splitEvent(0, press));
    expect(await handleEvent(ctx, team, id, splitEvent(1, endZone))).toBe("planned");

    // six plays to read, not twelve, and the end zone isn't one of the places they are cut from
    expect(await getView(ctx, OWNER, id)).toMatchObject({ stage: "reading", total: 6, plan: { plays: 6, matched: 6, recovered: 0, skipped: 0, otherAngles: 1 } });
    const clips = (dispatcher.sent as { clips: { name: string; source: { url: string } }[] }[]).flatMap((d) => d.clips);
    expect(clips.map((c) => c.name)).toEqual(["play_001.mp4", "play_002.mp4", "play_003.mp4", "play_004.mp4", "play_005.mp4", "play_006.mp4"]);
    expect(clips.every((c) => c.source.url.includes("/video/0?"))).toBe(true);
  });

  it("reads the video marked as the press box even when it was uploaded second", async () => {
    const files = [{ name: "end_zone.mp4", size: 8000, read: false }, { name: "press_box.mp4", size: 8001, read: true }];
    const { job, uploads } = await createJob(ctx, OWNER, limits, files, "video");
    for (const u of uploads) storage.addClip(u.pathname, files[u.index].size);
    await startJob(ctx, OWNER, job.id);
    const team = teamKey(OWNER);
    dispatcher.sent.length = 0;
    const press = Array.from({ length: 6 }, (_, i) => p(60 + i * 40, 63 + i * 40, 72 + i * 40));
    const endZone = press.map((x) => ({ ...x, start: x.start + 10, snap: x.snap + 10, end: x.end + 10 }));
    await handleEvent(ctx, team, job.id, splitEvent(0, endZone));
    await handleEvent(ctx, team, job.id, splitEvent(1, press));
    const clips = (dispatcher.sent as { clips: { source: { url: string; start: number } }[] }[]).flatMap((d) => d.clips);
    expect(clips).toHaveLength(6);
    expect(clips.every((c) => c.source.url.includes("/video/1?"))).toBe(true);
    expect(clips[0].source.start).toBe(60); // the press box's own time, not the end zone's
  });

  it("serves a video to the worker by range, and only while the game is running", async () => {
    const { id, team } = await started();
    const path = paths.video(team, id, 0, "first_half.mp4");
    storage.objects.set(path, { bytes: Uint8Array.from({ length: 100 }, (_, i) => i), uploadedAt: new Date(), contentType: "video/mp4" });
    const whole = await openVideoForWorker(ctx, team, id, 0, null);
    expect(whole).toMatchObject({ size: 100, contentRange: null });
    const part = await openVideoForWorker(ctx, team, id, 0, "bytes=10-19");
    expect(part).toMatchObject({ size: 10, contentRange: "bytes 10-19/100" });
    expect(Array.from(new Uint8Array(await new Response(part.stream).arrayBuffer()))).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    const open = await openVideoForWorker(ctx, team, id, 0, "bytes=90-");
    expect(open.contentRange).toBe("bytes 90-99/100");
    // a malformed Range is ignored, not passed to the store
    expect((await openVideoForWorker(ctx, team, id, 0, "bytes=oops")).contentRange).toBeNull();
    await expect(openVideoForWorker(ctx, team, id, 7, null)).rejects.toMatchObject({ status: 404 });
    await handleEvent(ctx, team, id, { type: "failed", error: "x" });
    await expect(openVideoForWorker(ctx, team, id, 0, null)).rejects.toMatchObject({ status: 409 });
  });

  it("deletes the videos with the rest of the film after the retention, and keeps the game", async () => {
    const { id, team } = await started();
    await handleEvent(ctx, team, id, splitEvent(0, [p(30, 33, 42)]));
    await handleEvent(ctx, team, id, splitEvent(1, []));
    await handleEvent(ctx, team, id, clipEvent(0, "done", { name: "play_001.mp4" }));
    await storeResult(ctx, team, id, gz({ cards: [{}] }));
    await handleEvent(ctx, team, id, { type: "assembled", plays: 1 });
    clock += (CLIP_RETENTION_DAYS + 1) * DAY;
    await cleanup(ctx);
    const left = [...storage.objects.keys()];
    expect(left.some((k) => k.includes("/videos/") || k.includes("/split/") || k.includes("/status/"))).toBe(false);
    expect(left).toContain(paths.game(team, id));
  });
});

describe("the staff's games: names and their own copy of the cards", () => {
  async function readyGame(name?: string) {
    const { job, uploads } = await createJob(ctx, OWNER, limits, files(1), "clips", name);
    for (const u of uploads) storage.addClip(u.pathname, 4000 + u.index);
    await startJob(ctx, OWNER, job.id);
    const team = teamKey(OWNER);
    await handleEvent(ctx, team, job.id, clipEvent(0));
    await storeResult(ctx, team, job.id, gz({ fileName: "g", cards: [{ id: "a" }, { id: "b" }] }));
    await handleEvent(ctx, team, job.id, { type: "assembled", plays: 2 });
    return { id: job.id, team };
  }
  const text = async (id: string, owner = OWNER) => JSON.parse(await new Response((await openGame(ctx, owner, id)).stream).text());
  const edited = {
    fileName: "g",
    cards: [
      { id: "a", reviewedAt: "2026-10-21T10:00:00Z", routeOverrides: { X: { path: [[0, -30]], source: "video" }, Z: { path: [[0, -40]], source: "video" } }, routeChecks: { X: "right" } },
      { id: "b" },
    ],
  };

  it("names a game at upload, renames it, and clears the name", async () => {
    const { id } = await readyGame("  vs   Central\n");
    expect((await getView(ctx, OWNER, id)).name).toBe("vs Central");
    expect((await renameJob(ctx, OWNER, id, "Week 7 at North")).name).toBe("Week 7 at North");
    expect((await renameJob(ctx, OWNER, id, "x".repeat(200))).name).toHaveLength(60);
    expect((await renameJob(ctx, OWNER, id, "")).name).toBe("");
    await expect(renameJob(ctx, OWNER, id, 5)).rejects.toMatchObject({ status: 400 });
    await expect(renameJob(ctx, "org_other", id, "mine")).rejects.toMatchObject({ status: 404 });
  });

  it("opens the film's cards until the staff saves its own copy, then that copy, with the review's progress on the game", async () => {
    const { id } = await readyGame();
    expect((await text(id)).cards[0].routeChecks).toBeUndefined();
    clock += HOUR;
    const view = await saveGameCards(ctx, OWNER, id, gz(edited));
    expect(view.saved).toEqual({ at: new Date(clock).toISOString(), plays: 2, checked: 1, routesRated: 1, routesTotal: 2 });
    expect((await text(id)).cards[0].routeChecks).toEqual({ X: "right" });
    // Plain JSON is taken too.
    await saveGameCards(ctx, OWNER, id, new TextEncoder().encode(JSON.stringify({ ...edited, cards: [{ id: "a" }] })));
    expect((await text(id)).cards).toHaveLength(1);
  });

  it("refuses a copy that isn't a game's cards, a game that isn't finished, and another staff", async () => {
    const { id } = await readyGame();
    await expect(saveGameCards(ctx, OWNER, id, gz({ cards: [] }))).rejects.toMatchObject({ status: 400 });
    await expect(saveGameCards(ctx, OWNER, id, new TextEncoder().encode("not json"))).rejects.toMatchObject({ status: 400 });
    await expect(saveGameCards(ctx, "org_other", id, gz(edited))).rejects.toMatchObject({ status: 404 });
    const { id: running } = await startGame(1);
    await expect(saveGameCards(ctx, OWNER, running, gz(edited))).rejects.toMatchObject({ status: 409 });
  });

  it("keeps the staff's copy when the film is deleted after the retention", async () => {
    const { id, team } = await readyGame();
    await saveGameCards(ctx, OWNER, id, gz(edited));
    clock += (CLIP_RETENTION_DAYS + 1) * DAY;
    expect(await cleanup(ctx)).toMatchObject({ filmDeleted: 1 });
    expect([...storage.objects.keys()]).toContain(paths.cards(team, id));
    expect((await text(id)).cards[0].routeChecks).toEqual({ X: "right" });
  });
});

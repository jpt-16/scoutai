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

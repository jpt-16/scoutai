/**
 * The film-job operations, written against two small interfaces so they run the same on the real
 * Blob store and in tests: `FilmStorage` (where jobs, film, tracks and games live) and `Dispatcher`
 * (how the hosted worker is told about work). The routes in `src/app/api/film/*` are thin wrappers.
 *
 * The flow, in the order it happens:
 *   createJob       the coach picks clips: checked against the staff's limits, a job record is written
 *   authorizeUpload the browser uploads each clip straight to storage, one path per clip, checked here
 *   startJob        every clip is there: the job is marked processing and the clips go to the worker in shards
 *   handleEvent     the worker reports each clip; when the last one has, the assemble is dispatched, once
 *   storeTracks /   the worker sends each clip's tracks, and at the end the finished game, through the app
 *   storeResult     (gzipped): the app is the only thing that touches the film store
 *   getGame         the coach opens the finished game
 *   cleanup         the daily sweep: film older than the retention is deleted, the game stays
 */

import { gunzipSync } from "node:zlib";
import type { TierLimits } from "../usageLimits";
import {
  cleanupFor,
  checkNewJob,
  checkNewVideoJob,
  cleanSplit,
  parseVideoPath,
  planGame,
  isValidClipName,
  paths,
  parseClipPath,
  parseJobPath,
  parseStatusPath,
  planShards,
  readyToAssemble,
  teamKey,
  viewOf,
  workerToken,
  newJobId,
  type ClipStatus,
  type ClipStatusKind,
  type FilmJob,
  type JobClip,
  type JobKind,
  type SplitReport,
  type JobView,
} from "./jobs";

export interface StoredObject {
  pathname: string;
  size: number;
  uploadedAt: Date;
}

export interface FilmStorage {
  getJson<T>(pathname: string): Promise<T | null>;
  /** `exclusive`: write only if nothing is there yet; returns false when something is. */
  putJson(pathname: string, value: unknown, opts?: { exclusive?: boolean }): Promise<boolean>;
  putBytes(pathname: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** `range`: an HTTP Range header value ("bytes=0-99"); `contentRange` comes back when the store honored it. */
  getStream(
    pathname: string,
    opts?: { range?: string },
  ): Promise<{ stream: ReadableStream<Uint8Array>; size: number | null; contentRange?: string | null } | null>;
  list(prefix: string): Promise<StoredObject[]>;
  remove(pathnames: string[]): Promise<void>;
}

export interface Dispatcher {
  configured(): boolean;
  send(body: Record<string, unknown>): Promise<void>;
}

export interface FilmContext {
  storage: FilmStorage;
  dispatcher: Dispatcher;
  /** The secret the worker's per-job tokens are made from. */
  secret: string;
  /** The app's public address, which the worker calls back. */
  origin: string;
  now: () => number;
}

export class FilmError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Largest a worker's gzipped upload may be once opened (the app's functions take 4.5 MB a request, gzipped). */
const MAX_UNZIPPED_BYTES = 60 * 1024 * 1024;

const iso = (ms: number) => new Date(ms).toISOString();

/* ------------------------------------------------------------------ reading jobs */

async function readJob(ctx: FilmContext, team: string, id: string): Promise<FilmJob | null> {
  return ctx.storage.getJson<FilmJob>(paths.job(team, id));
}

async function writeJob(ctx: FilmContext, team: string, job: FilmJob, patch: Partial<FilmJob>): Promise<FilmJob> {
  const next = { ...job, ...patch, updatedAt: iso(ctx.now()) };
  await ctx.storage.putJson(paths.job(team, job.id), next);
  return next;
}

/** Which clips have reported and how, from the listing alone (the outcome is in each report's name). */
async function statusIndex(ctx: FilmContext, team: string, id: string): Promise<{ index: number; kind: ClipStatusKind; pathname: string }[]> {
  const found = await ctx.storage.list(paths.statuses(team, id));
  const byIndex = new Map<number, { index: number; kind: ClipStatusKind; pathname: string }>();
  for (const o of found) {
    const parsed = parseStatusPath(o.pathname);
    if (parsed) byIndex.set(parsed.index, { ...parsed, pathname: o.pathname });
  }
  return [...byIndex.values()];
}

/** Every report in full (the assemble step needs each clip's formation). */
async function readStatuses(ctx: FilmContext, team: string, id: string): Promise<ClipStatus[]> {
  const all = await Promise.all((await statusIndex(ctx, team, id)).map((e) => ctx.storage.getJson<ClipStatus>(e.pathname)));
  return all.filter((s): s is ClipStatus => s != null);
}

async function jobsOf(ctx: FilmContext, team: string): Promise<FilmJob[]> {
  const found = await ctx.storage.list(paths.jobs(team));
  const all = await Promise.all(found.map((o) => ctx.storage.getJson<FilmJob>(o.pathname)));
  return all.filter((j): j is FilmJob => j != null);
}

async function viewFor(ctx: FilmContext, team: string, job: FilmJob): Promise<JobView> {
  if (job.state === "uploading") return viewOf(job, []);
  // Progress is a listing; only the clips that need attention are opened, for their reasons.
  const index = await statusIndex(ctx, team, job.id);
  const statuses = await Promise.all(
    index.map(async (e): Promise<ClipStatus | null> => {
      const clip = job.clips.find((c) => c.index === e.index);
      if (!clip) return null;
      if (e.kind === "done") return { index: e.index, name: clip.name, status: "done", reason: "", formation: "", strength: "", seconds: 0, at: "" };
      return ctx.storage.getJson<ClipStatus>(e.pathname);
    }),
  );
  return viewOf(job, statuses.filter((s): s is ClipStatus => s != null));
}

export async function listViews(ctx: FilmContext, owner: string): Promise<JobView[]> {
  const team = teamKey(owner);
  const jobs = (await jobsOf(ctx, team)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return Promise.all(jobs.map((j) => viewFor(ctx, team, j)));
}

export async function getView(ctx: FilmContext, owner: string, id: string): Promise<JobView> {
  const team = teamKey(owner);
  let job = await readJob(ctx, team, id);
  if (!job) throw new FilmError(404, "not_found", "That game isn't in your library.");
  // A coach watching a game that is waiting on its last report nudges the assemble along (see tryAssemble).
  if (job.state === "processing") {
    if (job.kind === "video" && job.clips.length === 0) await tryPlan(ctx, team, job);
    else await tryAssemble(ctx, team, job);
    job = (await readJob(ctx, team, id)) ?? job;
  }
  return viewFor(ctx, team, job);
}

/* ------------------------------------------------------------------ creating and uploading */

export interface Upload {
  index: number;
  name: string;
  pathname: string;
}

export async function createJob(
  ctx: FilmContext,
  owner: string,
  limits: TierLimits["film"],
  files: unknown,
  kind: JobKind = "clips",
): Promise<{ job: JobView; uploads: Upload[] }> {
  const team = teamKey(owner);
  const existing = await jobsOf(ctx, team);
  const id = newJobId();
  const at = iso(ctx.now());
  let job: FilmJob;
  if (kind === "video") {
    const checked = checkNewVideoJob(files, limits, existing, ctx.now());
    if (!checked.ok) throw new FilmError(429, "limit", checked.message);
    job = { id, state: "uploading", createdAt: at, updatedAt: at, kind: "video", videos: checked.value, maxPlays: limits.maxPlays, clips: [] };
  } else {
    const checked = checkNewJob(files, limits, existing, ctx.now());
    if (!checked.ok) throw new FilmError(429, "limit", checked.message);
    job = { id, state: "uploading", createdAt: at, updatedAt: at, clips: checked.value };
  }
  if (!(await ctx.storage.putJson(paths.job(team, id), job, { exclusive: true }))) {
    throw new FilmError(500, "collision", "Couldn't start that game. Try again.");
  }
  return {
    job: viewOf(job, []),
    uploads: job.videos
      ? job.videos.map((v) => ({ index: v.index, name: v.name, pathname: paths.video(team, id, v.index, v.name) }))
      : job.clips.map((c) => ({ index: c.index, name: c.name, pathname: paths.clip(team, id, c.index, c.name) })),
  };
}

/** The browser may upload to exactly the paths `createJob` handed out, while the job is waiting for them. */
export async function authorizeUpload(ctx: FilmContext, owner: string, pathname: string): Promise<{ maxBytes: number }> {
  const refuse = () => new FilmError(403, "bad_path", "That isn't one of your game's files.");
  const clip = parseClipPath(pathname);
  const video = clip ? null : parseVideoPath(pathname);
  const parsed = clip ?? video;
  if (!parsed || parsed.team !== teamKey(owner)) throw refuse();
  const job = await readJob(ctx, parsed.team, parsed.job);
  if (!job || job.state !== "uploading") throw refuse();
  const entry = video
    ? job.videos?.find((v) => v.index === video.index && v.name === video.name)
    : job.clips.find((c) => c.index === parsed.index && c.name === parsed.name);
  if (!entry) throw refuse();
  return { maxBytes: entry.size };
}

/* ------------------------------------------------------------------ starting */

function callbackBase(ctx: FilmContext, team: string, id: string): string {
  return `${ctx.origin}/api/film/worker/${team}/${id}`;
}

/** Where the worker reads a long video from (by range: it seeks), authorized by the job's own token in the address. */
function videoUrl(base: string, token: string, video: number): string {
  return `${base}/video/${video}?t=${token}`;
}

/** Sends the clips to the worker in shards. Throws what the dispatcher throws. */
async function dispatchShards(ctx: FilmContext, team: string, job: FilmJob): Promise<void> {
  const base = callbackBase(ctx, team, job.id);
  const token = workerToken(ctx.secret, team, job.id);
  await Promise.all(
    planShards<JobClip>(job.clips).map((shard) =>
      ctx.dispatcher.send({
        type: "shard",
        jobId: job.id,
        callbackUrl: base,
        token,
        options: {},
        clips: shard.map((c) => ({
          index: c.index,
          name: c.name,
          // A clip the coach uploaded is fetched whole; a play found in a long video is a stretch of that video.
          ...(c.source
            ? { source: { url: videoUrl(base, token, c.source.video), start: c.source.start, end: c.source.end } }
            : { url: `${base}/clip/${c.index}` }),
          tracksPutUrl: `${base}/tracks/${c.index}`,
        })),
      }),
    ),
  );
}

const failureMessage = (error: unknown) => (error instanceof FilmError ? error.message : "Couldn't reach the film analyzer.");

export async function startJob(ctx: FilmContext, owner: string, id: string): Promise<JobView> {
  const team = teamKey(owner);
  const job = await readJob(ctx, team, id);
  if (!job) throw new FilmError(404, "not_found", "That game isn't in your library.");
  if (job.state !== "uploading") throw new FilmError(409, "already_started", "That game has already been started.");
  if (!ctx.dispatcher.configured()) {
    throw new FilmError(501, "worker_off", "Film processing isn't switched on for this site yet.");
  }

  if (job.kind === "video") {
    // Every video has to have landed, whole.
    const stored = new Map((await ctx.storage.list(paths.videos(team, id))).map((o) => [o.pathname, o.size]));
    const missing = (job.videos ?? []).filter((v) => stored.get(paths.video(team, id, v.index, v.name)) !== v.size);
    if (missing.length) {
      throw new FilmError(409, "missing_clips", `${missing.map((v) => v.name).join(", ")} didn't finish uploading. Upload it again.`);
    }
    const processing = await writeJob(ctx, team, job, { state: "processing" });
    const base = callbackBase(ctx, team, id);
    const token = workerToken(ctx.secret, team, id);
    try {
      await Promise.all(
        (processing.videos ?? []).map((v) =>
          ctx.dispatcher.send({
            type: "split",
            jobId: id,
            callbackUrl: base,
            token,
            video: { index: v.index, name: v.name, url: videoUrl(base, token, v.index) },
          }),
        ),
      );
    } catch (error) {
      return viewFor(ctx, team, await writeJob(ctx, team, processing, { state: "failed", error: failureMessage(error) }));
    }
    return viewFor(ctx, team, processing);
  }

  // Every clip has to have landed, whole.
  const stored = new Map((await ctx.storage.list(paths.clips(team, id))).map((o) => [o.pathname, o.size]));
  const missing = job.clips.filter((c) => stored.get(paths.clip(team, id, c.index, c.name)) !== c.size);
  if (missing.length) {
    const names = missing.slice(0, 3).map((c) => c.name).join(", ");
    throw new FilmError(409, "missing_clips", `${missing.length} ${missing.length === 1 ? "clip" : "clips"} didn't finish uploading (${names}${missing.length > 3 ? ", …" : ""}). Upload them again.`);
  }

  const processing = await writeJob(ctx, team, job, { state: "processing" });
  try {
    await dispatchShards(ctx, team, processing);
  } catch (error) {
    return viewFor(ctx, team, await writeJob(ctx, team, processing, { state: "failed", error: failureMessage(error) }));
  }
  return viewFor(ctx, team, processing);
}

/* ------------------------------------------------------------------ what the worker says */

export type WorkerEvent =
  | { type: "clip"; index: number; name: string; status: string; reason?: string; formation?: string; strength?: string; seconds?: number }
  | { type: "split"; index: number; name?: string; duration: number; plays: unknown }
  | { type: "assembled"; plays?: number }
  | { type: "failed"; error?: string };

const STATUS_KINDS = ["done", "needs_hand", "failed"];

function playNumber(name: string, index: number): string {
  const m = name.match(/\d+/);
  return m ? String(parseInt(m[0], 10)) : String(index + 1);
}

/** Returns what was done, for the route's answer and for tests. */
export async function handleEvent(ctx: FilmContext, team: string, id: string, event: WorkerEvent): Promise<"stored" | "planned" | "assembling" | "ready" | "failed" | "ignored"> {
  const job = await readJob(ctx, team, id);
  if (!job || job.state !== "processing") return "ignored";

  if (event.type === "split") {
    const report = cleanSplit(event.index, event.duration, event.plays);
    if (job.kind !== "video" || job.clips.length > 0 || !report || !job.videos?.some((v) => v.index === report.index)) return "ignored";
    await ctx.storage.putJson(paths.split(team, id, report.index), report);
    return tryPlan(ctx, team, job);
  }

  if (event.type === "failed") {
    await writeJob(ctx, team, job, { state: "failed", error: String(event.error ?? "The film analyzer stopped.").slice(0, 300) });
    return "failed";
  }

  if (event.type === "assembled") {
    const game = await ctx.storage.list(paths.game(team, id));
    if (!game.length) {
      await writeJob(ctx, team, job, { state: "failed", error: "The cards were built but never arrived." });
      return "failed";
    }
    await writeJob(ctx, team, job, { state: "ready", plays: Number.isFinite(Number(event.plays)) ? Number(event.plays) : undefined });
    return "ready";
  }

  const clip = job.clips.find((c) => c.index === event.index);
  if (!clip || clip.name !== event.name || !STATUS_KINDS.includes(event.status)) return "ignored";
  const status: ClipStatus = {
    index: clip.index,
    name: clip.name,
    status: event.status as ClipStatus["status"],
    reason: String(event.reason ?? "").slice(0, 300),
    formation: String(event.formation ?? "").slice(0, 40),
    strength: String(event.strength ?? "").slice(0, 20),
    seconds: Number(event.seconds) || 0,
    at: iso(ctx.now()),
  };
  await ctx.storage.putJson(paths.status(team, id, clip.index, status.status), status);

  // One cheap listing per report (plus this one, in case the store hasn't caught up); the reports
  // themselves are read only when everyone has reported.
  const reported = new Set((await statusIndex(ctx, team, id)).map((e) => e.index));
  reported.add(clip.index);
  if (reported.size < job.clips.length) return "stored";
  return tryAssemble(ctx, team, job);
}

/**
 * If every video has been split, number the plays across them and send them to the worker (once). Called by the
 * last split report, and again by a status poll, like `tryAssemble`.
 */
async function tryPlan(ctx: FilmContext, team: string, job: FilmJob): Promise<"stored" | "planned" | "failed"> {
  if (job.kind !== "video" || job.clips.length > 0 || job.state !== "processing") return "stored";
  const wanted = job.videos?.length ?? 0;
  const found = await ctx.storage.list(paths.splits(team, job.id));
  if (found.length < wanted) return "stored";
  const reports = (await Promise.all(found.map((o) => ctx.storage.getJson<SplitReport>(o.pathname)))).filter((r): r is SplitReport => r != null);
  if (reports.length < wanted) return "stored";
  if (!(await ctx.storage.putJson(paths.planned(team, job.id), { at: iso(ctx.now()) }, { exclusive: true }))) return "stored";

  const plan = planGame(reports, job.maxPlays ?? 150, new Set((job.videos ?? []).filter((v) => v.read).map((v) => v.index)));
  if (!plan.ok) {
    await writeJob(ctx, team, job, { state: "failed", error: plan.message });
    return "failed";
  }
  const planned = await writeJob(ctx, team, job, { clips: plan.value.clips, plan: plan.value.summary });
  try {
    await dispatchShards(ctx, team, planned);
  } catch (error) {
    await writeJob(ctx, team, planned, { state: "failed", error: failureMessage(error) });
    return "failed";
  }
  return "planned";
}

/**
 * If every clip has reported, start the assemble (once). Called by the last report, and again each time the
 * coach's screen asks for the job's status, so two reports landing at the same instant, each thinking the
 * other hadn't arrived, can't leave a game stuck.
 */
async function tryAssemble(ctx: FilmContext, team: string, job: FilmJob): Promise<"stored" | "assembling" | "failed"> {
  const id = job.id;
  if ((await statusIndex(ctx, team, id)).length < job.clips.length) return "stored";
  const statuses = await readStatuses(ctx, team, id);
  const next = readyToAssemble(job, statuses);
  if (next === "wait") return "stored";
  if (next === "fail") {
    await writeJob(ctx, team, job, { state: "failed", error: "None of the clips could be read. Check the film and calibrate by hand." });
    return "failed";
  }

  // Whichever gets here first starts the assemble, and only one of them: the marker can be made once.
  if (!(await ctx.storage.putJson(paths.assembling(team, id), { at: iso(ctx.now()) }, { exclusive: true }))) return "stored";
  const base = callbackBase(ctx, team, id);
  const done = statuses.filter((s) => s.status === "done").sort((a, b) => a.index - b.index);
  try {
    await ctx.dispatcher.send({
      type: "assemble",
      jobId: id,
      callbackUrl: base,
      token: workerToken(ctx.secret, team, id),
      tracks: done.map((s) => ({ name: s.name, url: `${base}/tracks/${s.index}` })),
      forms: done.map((s) => ({ "PLAY #": playNumber(s.name, s.index), "OFF FORM": s.formation, "OFF STR": s.strength })),
      resultPutUrl: `${base}/result`,
    });
  } catch (error) {
    await writeJob(ctx, team, job, { state: "failed", error: error instanceof FilmError ? error.message : "Couldn't reach the film analyzer." });
    return "failed";
  }
  return "assembling";
}

function gunzipJson(body: Uint8Array): unknown {
  let text: string;
  try {
    text = gunzipSync(body, { maxOutputLength: MAX_UNZIPPED_BYTES }).toString("utf8");
  } catch {
    throw new FilmError(400, "bad_body", "Expected gzipped JSON.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new FilmError(400, "bad_body", "Expected JSON.");
  }
}

async function processingJob(ctx: FilmContext, team: string, id: string): Promise<FilmJob> {
  const job = await readJob(ctx, team, id);
  if (!job || job.state !== "processing") throw new FilmError(409, "not_processing", "That game isn't being processed.");
  return job;
}

export async function storeTracks(ctx: FilmContext, team: string, id: string, index: number, body: Uint8Array): Promise<void> {
  const job = await processingJob(ctx, team, id);
  if (!job.clips.some((c) => c.index === index)) throw new FilmError(404, "no_clip", "No such clip.");
  const tracks = gunzipJson(body);
  if (typeof tracks !== "object" || tracks == null) throw new FilmError(400, "bad_body", "Tracks must be an object.");
  await ctx.storage.putBytes(paths.tracks(team, id, index), Buffer.from(JSON.stringify(tracks)), "application/json");
}

export async function storeResult(ctx: FilmContext, team: string, id: string, body: Uint8Array): Promise<number> {
  await processingJob(ctx, team, id);
  const game = gunzipJson(body) as { cards?: unknown };
  if (!game || !Array.isArray(game.cards) || game.cards.length === 0) {
    throw new FilmError(400, "bad_body", "The game has no cards.");
  }
  await ctx.storage.putBytes(paths.game(team, id), Buffer.from(JSON.stringify(game)), "application/json");
  return game.cards.length;
}

/** The worker reads a clip (or a clip's tracks) through the app, which is the only thing holding the store's key. */
export async function openForWorker(
  ctx: FilmContext,
  team: string,
  id: string,
  kind: "clip" | "tracks",
  index: number,
): Promise<{ stream: ReadableStream<Uint8Array>; size: number | null; contentType: string }> {
  const job = await processingJob(ctx, team, id);
  const clip = job.clips.find((c) => c.index === index);
  if (!clip) throw new FilmError(404, "no_clip", "No such clip.");
  const pathname = kind === "clip" ? paths.clip(team, id, index, clip.name) : paths.tracks(team, id, index);
  const found = await ctx.storage.getStream(pathname);
  if (!found) throw new FilmError(404, "gone", "That file isn't there.");
  return { ...found, contentType: kind === "clip" ? "video/mp4" : "application/json" };
}

/**
 * A long video for the worker, by HTTP range: the worker seeks to a play in the middle of a game and asks for just
 * those bytes. `range` is the request's Range header; the answer says whether the store honored it.
 */
export async function openVideoForWorker(
  ctx: FilmContext,
  team: string,
  id: string,
  index: number,
  range: string | null,
): Promise<{ stream: ReadableStream<Uint8Array>; size: number | null; contentRange: string | null }> {
  const job = await processingJob(ctx, team, id);
  const video = job.videos?.find((v) => v.index === index);
  if (!video) throw new FilmError(404, "no_video", "No such video.");
  const found = await ctx.storage.getStream(paths.video(team, id, index, video.name), range && /^bytes=\d*-\d*$/.test(range) ? { range } : undefined);
  if (!found) throw new FilmError(404, "gone", "That file isn't there.");
  return { stream: found.stream, size: found.size, contentRange: found.contentRange ?? null };
}

/* ------------------------------------------------------------------ the finished game */

export async function openGame(ctx: FilmContext, owner: string, id: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number | null }> {
  const team = teamKey(owner);
  const job = await readJob(ctx, team, id);
  if (!job) throw new FilmError(404, "not_found", "That game isn't in your library.");
  if (job.state !== "ready") throw new FilmError(409, "not_ready", "That game isn't finished yet.");
  const found = await ctx.storage.getStream(paths.game(team, id));
  if (!found) throw new FilmError(404, "gone", "That game's file is missing.");
  return found;
}

/** The coach deletes a game now: the film, the tracks, the game file and the record. */
export async function deleteJob(ctx: FilmContext, owner: string, id: string): Promise<void> {
  const team = teamKey(owner);
  const job = await readJob(ctx, team, id);
  if (!job) throw new FilmError(404, "not_found", "That game isn't in your library.");
  const everything = await ctx.storage.list(paths.prefix(team, id));
  await ctx.storage.remove([...everything.map((o) => o.pathname), paths.job(team, id)]);
}

/* ------------------------------------------------------------------ the daily sweep */

export interface CleanupReport {
  checked: number;
  filmDeleted: number;
  removed: number;
  markedStuck: number;
}

async function removeFilm(ctx: FilmContext, team: string, id: string): Promise<void> {
  const found = await ctx.storage.list(paths.prefix(team, id));
  // The finished game stays; everything else (clips, tracks, reports, the marker) goes.
  await ctx.storage.remove(found.map((o) => o.pathname).filter((p) => p !== paths.game(team, id)));
}

export async function cleanup(ctx: FilmContext): Promise<CleanupReport> {
  const report: CleanupReport = { checked: 0, filmDeleted: 0, removed: 0, markedStuck: 0 };
  const records = await ctx.storage.list(paths.allJobs);
  for (const record of records) {
    const where = parseJobPath(record.pathname);
    if (!where) continue;
    const job = await ctx.storage.getJson<FilmJob>(record.pathname);
    if (!job) continue;
    report.checked++;
    const action = cleanupFor(job, ctx.now());
    if (action === "delete-all") {
      const everything = await ctx.storage.list(paths.prefix(where.team, where.job));
      await ctx.storage.remove([...everything.map((o) => o.pathname), record.pathname]);
      report.removed++;
    } else if (action === "delete-film") {
      await removeFilm(ctx, where.team, where.job);
      await writeJob(ctx, where.team, job, { clipsDeletedAt: iso(ctx.now()) });
      report.filmDeleted++;
    } else if (action === "mark-stuck") {
      await writeJob(ctx, where.team, job, { state: "failed", error: "Processing didn't finish. Upload the game again." });
      report.markedStuck++;
    }
  }
  return report;
}

/** Re-exported so routes validate names with the same rule the service uses. */
export { isValidClipName };

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
  getStream(pathname: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number | null } | null>;
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
    await tryAssemble(ctx, team, job);
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
): Promise<{ job: JobView; uploads: Upload[] }> {
  const team = teamKey(owner);
  const checked = checkNewJob(files, limits, await jobsOf(ctx, team), ctx.now());
  if (!checked.ok) throw new FilmError(429, "limit", checked.message);
  const id = newJobId();
  const at = iso(ctx.now());
  const job: FilmJob = { id, state: "uploading", createdAt: at, updatedAt: at, clips: checked.value };
  if (!(await ctx.storage.putJson(paths.job(team, id), job, { exclusive: true }))) {
    throw new FilmError(500, "collision", "Couldn't start that game. Try again.");
  }
  return {
    job: viewOf(job, []),
    uploads: job.clips.map((c) => ({ index: c.index, name: c.name, pathname: paths.clip(team, id, c.index, c.name) })),
  };
}

/** The browser may upload to exactly the paths `createJob` handed out, while the job is waiting for them. */
export async function authorizeUpload(ctx: FilmContext, owner: string, pathname: string): Promise<{ maxBytes: number }> {
  const parsed = parseClipPath(pathname);
  if (!parsed || parsed.team !== teamKey(owner)) throw new FilmError(403, "bad_path", "That isn't one of your game's clips.");
  const job = await readJob(ctx, parsed.team, parsed.job);
  const clip = job?.clips.find((c) => c.index === parsed.index && c.name === parsed.name);
  if (!job || job.state !== "uploading" || !clip) throw new FilmError(403, "bad_path", "That isn't one of your game's clips.");
  return { maxBytes: clip.size };
}

/* ------------------------------------------------------------------ starting */

function callbackBase(ctx: FilmContext, team: string, id: string): string {
  return `${ctx.origin}/api/film/worker/${team}/${id}`;
}

export async function startJob(ctx: FilmContext, owner: string, id: string): Promise<JobView> {
  const team = teamKey(owner);
  const job = await readJob(ctx, team, id);
  if (!job) throw new FilmError(404, "not_found", "That game isn't in your library.");
  if (job.state !== "uploading") throw new FilmError(409, "already_started", "That game has already been started.");
  if (!ctx.dispatcher.configured()) {
    throw new FilmError(501, "worker_off", "Film processing isn't switched on for this site yet.");
  }

  // Every clip has to have landed, whole.
  const stored = new Map((await ctx.storage.list(paths.clips(team, id))).map((o) => [o.pathname, o.size]));
  const missing = job.clips.filter((c) => stored.get(paths.clip(team, id, c.index, c.name)) !== c.size);
  if (missing.length) {
    const names = missing.slice(0, 3).map((c) => c.name).join(", ");
    throw new FilmError(409, "missing_clips", `${missing.length} ${missing.length === 1 ? "clip" : "clips"} didn't finish uploading (${names}${missing.length > 3 ? ", …" : ""}). Upload them again.`);
  }

  const processing = await writeJob(ctx, team, job, { state: "processing" });
  const base = callbackBase(ctx, team, id);
  const token = workerToken(ctx.secret, team, id);
  try {
    await Promise.all(
      planShards<JobClip>(processing.clips).map((shard) =>
        ctx.dispatcher.send({
          type: "shard",
          jobId: id,
          callbackUrl: base,
          token,
          options: {},
          clips: shard.map((c) => ({ index: c.index, name: c.name, url: `${base}/clip/${c.index}`, tracksPutUrl: `${base}/tracks/${c.index}` })),
        }),
      ),
    );
  } catch (error) {
    const message = error instanceof FilmError ? error.message : "Couldn't reach the film analyzer.";
    const failed = await writeJob(ctx, team, processing, { state: "failed", error: message });
    return viewFor(ctx, team, failed);
  }
  return viewFor(ctx, team, processing);
}

/* ------------------------------------------------------------------ what the worker says */

export type WorkerEvent =
  | { type: "clip"; index: number; name: string; status: string; reason?: string; formation?: string; strength?: string; seconds?: number }
  | { type: "assembled"; plays?: number }
  | { type: "failed"; error?: string };

const STATUS_KINDS = ["done", "needs_hand", "failed"];

function playNumber(name: string, index: number): string {
  const m = name.match(/\d+/);
  return m ? String(parseInt(m[0], 10)) : String(index + 1);
}

/** Returns what was done, for the route's answer and for tests. */
export async function handleEvent(ctx: FilmContext, team: string, id: string, event: WorkerEvent): Promise<"stored" | "assembling" | "ready" | "failed" | "ignored"> {
  const job = await readJob(ctx, team, id);
  if (!job || job.state !== "processing") return "ignored";

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

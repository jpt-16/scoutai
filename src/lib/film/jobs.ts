/**
 * Film jobs: a coach uploads a game's clips, the hosted worker (`video-service/eval/worker.py`)
 * reads them, and the scout cards come back as a game file in the staff's library.
 *
 * Everything here is pure (no storage, no network) so it can be tested alone: the shape of a job,
 * where each piece lives in the private Blob store, the token a worker proves itself with, how a game
 * is split into shards, what a job looks like to the coach, and when its film is deleted.
 *
 * Where things live, per staff (`<team>` = a hash of the team id, so a path never names a team) and job:
 *
 *   filmjobs/<team>/<job>.json            the job (written when it is created, started and finished); a
 *                                         separate prefix so listing a staff's games never pages through clips
 *   film/<team>/<job>/clips/<n>/<name>    the uploaded film, a clip a play (deleted after `CLIP_RETENTION_DAYS`)
 *   film/<team>/<job>/videos/<n>/<name>   or a whole game's video (a half, a game), which the worker cuts into plays
 *   film/<team>/<job>/split/<n>.json      the plays the worker found in video <n>
 *   film/<team>/<job>/planned             a marker: the clips are numbered and sent to the worker once
 *   film/<team>/<job>/status/<n>-<kind>.json  one clip's report from the worker (one writer each, no races);
 *                                         the outcome is in the name so progress is a listing, not N reads
 *   film/<team>/<job>/tracks/<n>.json     one clip's tracks, for the assemble step (deleted with the film)
 *   film/<team>/<job>/assembling          a marker: whichever clip reported last starts the assemble, once
 *   film/<team>/<job>/game.json           the finished game file, kept
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { TierLimits } from "../usageLimits";
import { groupVideos } from "./pairing";
import { CLIP_RETENTION_DAYS, MAX_CLIP_BYTES, MAX_GAME_NAME, MAX_VIDEOS, MAX_VIDEO_BYTES, isValidClipName } from "./shared";

export { CLIP_RETENTION_DAYS, MAX_CLIP_BYTES, MAX_GAME_NAME, MAX_VIDEOS, MAX_VIDEO_BYTES, isValidClipName } from "./shared";
/** A job still waiting for its uploads this long is abandoned and removed. */
export const ABANDONED_UPLOAD_DAYS = 2;
/** A job the worker never finished in this long is marked failed (the worker died, or lost the job). */
export const STUCK_JOB_HOURS = 6;
/** Clips per dispatch. A host that scales out works on shards at once; one box queues them. */
export const SHARD_SIZE = 6;

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

export type JobState = "uploading" | "processing" | "ready" | "failed";

export interface JobClip {
  index: number;
  name: string;
  size: number;
  /** A play found in a long video: where to cut it (seconds into video `video`). Absent for an uploaded clip. */
  source?: { video: number; start: number; end: number };
}

/** What the split found, kept on the job so the coach can see how the angles were matched. */
export interface PlanSummary {
  /** Plays that will be read (each from the press-box video). */
  plays: number;
  /** Of those, plays the other angle saw too. */
  matched: number;
  /** Plays only the other angle caught, cut from the press-box video at the same moment. */
  recovered: number;
  /** Plays only the other angle caught that the press-box recording doesn't cover: not read. */
  skipped: number;
  /** Videos that turned out to be other angles of a game (matched to a press-box video, not read). */
  otherAngles: number;
  /** Videos marked "other angle" that matched no press-box video, so were read on their own. */
  readAlone: number;
}

/** A whole game's video the coach uploaded, for the worker to find the plays in. */
export interface JobVideo {
  index: number;
  name: string;
  size: number;
  /** The one to read (the press box). A video marked false is another angle of the same game: it is used to recognize
   * each play and to find plays the press box missed, and is never read itself. */
  read: boolean;
}

export type JobKind = "clips" | "video";

export interface FilmJob {
  id: string;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  /** "clips" (one per play) or "video" (whole-game videos, split into plays by the worker). Absent = "clips". */
  kind?: JobKind;
  /** For a video game: the videos. */
  videos?: JobVideo[];
  /** The most plays the staff's plan allows, kept so it can be checked when a split finds them. */
  maxPlays?: number;
  /** The plays: uploaded clips, or (for a video game) filled in once every video has been split. */
  clips: JobClip[];
  /** For a video game: how the split went. */
  plan?: PlanSummary;
  /** Cards in the finished game. */
  plays?: number;
  error?: string;
  /** When the film was deleted (by retention, or by the coach). The game file stays. */
  clipsDeletedAt?: string;
  /** The staff's name for the game ("vs Central"); unset shows as the date. */
  name?: string;
  /** The staff's own copy of the cards (edits, review checks, route ratings), when it was last saved and how far the review is. */
  saved?: GameProgress;
}

/** How far a staff has gone through a game's cards, counted when its copy is saved. */
export interface GameProgress {
  at: string;
  plays: number;
  /** Plays checked in Review mode. */
  checked: number;
  routesRated: number;
  routesTotal: number;
}

export type ClipStatusKind = "done" | "needs_hand" | "failed";

/** One clip's report from the worker. */
export interface ClipStatus {
  index: number;
  name: string;
  status: ClipStatusKind;
  reason: string;
  formation: string;
  strength: string;
  seconds: number;
  at: string;
}

/** What the coach sees. */
export interface JobView {
  id: string;
  state: JobState;
  createdAt: string;
  total: number;
  /** Clips the worker has reported on so far. */
  reported: number;
  /** Clips read properly. */
  read: number;
  needsHand: { name: string; reason: string }[];
  failed: { name: string; reason: string }[];
  /** "uploading", "splitting" (finding the plays in a video), "reading" (clips being read), "building" (all reported,
   * cards being made), "ready", "failed". */
  stage: "uploading" | "splitting" | "reading" | "building" | "ready" | "failed";
  /** For a video game once split: the plays found and how many were seen from more than one angle. */
  plan?: PlanSummary;
  /** "video" for a game uploaded as whole videos, and how many videos. */
  kind: JobKind;
  videos: number;
  plays?: number;
  error?: string;
  /** When the film is deleted (null once it has been). */
  filmDeletedAt: string | null;
  filmExpiresAt: string | null;
  /** The staff's name for it, "" when none. */
  name: string;
  saved?: GameProgress;
}

/* ------------------------------------------------------------------ names and paths */

export function teamKey(owner: string): string {
  return createHash("sha256").update(owner).digest("hex").slice(0, 24);
}

export function newJobId(): string {
  return randomBytes(9).toString("hex");
}

export function isValidTeamKey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{24}$/.test(value);
}

export function isValidJobId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{18}$/.test(value);
}

const prefix = (team: string, job: string) => `film/${team}/${job}/`;
export const paths = {
  prefix,
  job: (team: string, job: string) => `filmjobs/${team}/${job}.json`,
  jobs: (team: string) => `filmjobs/${team}/`,
  allJobs: "filmjobs/",
  clip: (team: string, job: string, index: number, name: string) => `${prefix(team, job)}clips/${index}/${name}`,
  clips: (team: string, job: string) => `${prefix(team, job)}clips/`,
  video: (team: string, job: string, index: number, name: string) => `${prefix(team, job)}videos/${index}/${name}`,
  videos: (team: string, job: string) => `${prefix(team, job)}videos/`,
  split: (team: string, job: string, index: number) => `${prefix(team, job)}split/${index}.json`,
  splits: (team: string, job: string) => `${prefix(team, job)}split/`,
  planned: (team: string, job: string) => `${prefix(team, job)}planned`,
  status: (team: string, job: string, index: number, kind: ClipStatusKind) => `${prefix(team, job)}status/${index}-${kind}.json`,
  statuses: (team: string, job: string) => `${prefix(team, job)}status/`,
  tracks: (team: string, job: string, index: number) => `${prefix(team, job)}tracks/${index}.json`,
  tracksDir: (team: string, job: string) => `${prefix(team, job)}tracks/`,
  assembling: (team: string, job: string) => `${prefix(team, job)}assembling`,
  game: (team: string, job: string) => `${prefix(team, job)}game.json`,
  /** The staff's working copy of the cards: opened instead of `game` once there is one, and kept, like it, after the film goes. */
  cards: (team: string, job: string) => `${prefix(team, job)}cards.json`,
};

/** A game name as typed: one line, trimmed, at most `MAX_GAME_NAME` characters; "" clears it. Null when it isn't text. */
export function cleanGameName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_GAME_NAME).trim();
}

/** `film/<team>/<job>/videos/<n>/<name>`, or null. */
export function parseVideoPath(pathname: string): { team: string; job: string; index: number; name: string } | null {
  const m = pathname.match(/^film\/([0-9a-f]{24})\/([0-9a-f]{18})\/videos\/(\d{1,2})\/([^/]+)$/);
  if (!m || !isValidClipName(m[4])) return null;
  return { team: m[1], job: m[2], index: Number(m[3]), name: m[4] };
}

/** `…/status/<n>-<kind>.json`, or null. */
export function parseStatusPath(pathname: string): { index: number; kind: ClipStatusKind } | null {
  const m = pathname.match(/\/status\/(\d{1,4})-(done|needs_hand|failed)\.json$/);
  return m ? { index: Number(m[1]), kind: m[2] as ClipStatusKind } : null;
}

/** `filmjobs/<team>/<job>.json`, or null. */
export function parseJobPath(pathname: string): { team: string; job: string } | null {
  const m = pathname.match(/^filmjobs\/([0-9a-f]{24})\/([0-9a-f]{18})\.json$/);
  return m ? { team: m[1], job: m[2] } : null;
}

/** `film/<team>/<job>/clips/<n>/<name>`, or null. */
export function parseClipPath(pathname: string): { team: string; job: string; index: number; name: string } | null {
  const m = pathname.match(/^film\/([0-9a-f]{24})\/([0-9a-f]{18})\/clips\/(\d{1,4})\/([^/]+)$/);
  if (!m || !isValidClipName(m[4])) return null;
  return { team: m[1], job: m[2], index: Number(m[3]), name: m[4] };
}

/* ------------------------------------------------------------------ the worker's token */

/** What a worker proves itself with: tied to one job of one team, so a leaked token reaches nothing else. */
export function workerToken(secret: string, team: string, job: string): string {
  return createHmac("sha256", secret).update(`${team}:${job}`).digest("hex");
}

export function verifyWorkerToken(secret: string | undefined, team: string, job: string, given: string | null): boolean {
  if (!secret || !given) return false;
  const expected = Buffer.from(workerToken(secret, team, job));
  const got = Buffer.from(given);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/* ------------------------------------------------------------------ making a job */

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

/** The staff's running and recent games against the tier's limits (shared by clip and video games). */
function checkGameLimits(limits: TierLimits["film"], existing: FilmJob[], now: number): Checked<true> {
  const active = existing.filter((j) => (j.state === "uploading" || j.state === "processing") && now - Date.parse(j.updatedAt) < STUCK_JOB_HOURS * HOUR);
  if (active.length >= limits.activeJobs) {
    return {
      ok: false,
      message: `Your staff already has ${active.length} ${active.length === 1 ? "game" : "games"} processing (limit ${limits.activeJobs} at a time). Try again when ${active.length === 1 ? "it finishes" : "one finishes"}.`,
    };
  }
  const recent = existing.filter((j) => now - Date.parse(j.createdAt) < 7 * DAY);
  if (recent.length >= limits.jobsPerWeek) {
    return { ok: false, message: `That's ${limits.jobsPerWeek} games in the last week, the limit for now. Ask us if you need more.` };
  }
  return { ok: true, value: true };
}

/** The files a coach picked, checked against the tier's limits and each other. */
export function checkNewJob(
  files: unknown,
  limits: TierLimits["film"],
  existing: FilmJob[],
  now: number,
): Checked<JobClip[]> {
  if (!Array.isArray(files) || files.length === 0) return { ok: false, message: "Pick the clips to upload." };
  if (files.length > limits.maxPlays) {
    return { ok: false, message: `A game can have at most ${limits.maxPlays} plays; you picked ${files.length}. Split it into two uploads.` };
  }
  const seen = new Set<string>();
  const clips: JobClip[] = [];
  for (const f of files as { name?: unknown; size?: unknown }[]) {
    if (!isValidClipName(f?.name)) {
      return { ok: false, message: `"${String(f?.name).slice(0, 60)}" isn't a clip the analyzer can read. Use .mp4, .mov or .m4v files with plain names.` };
    }
    const size = Number(f.size);
    if (!Number.isFinite(size) || size <= 0) return { ok: false, message: `${f.name} is empty.` };
    if (size > MAX_CLIP_BYTES) {
      return { ok: false, message: `${f.name} is ${Math.round(size / 1024 / 1024)} MB. A single play can be up to ${MAX_CLIP_BYTES / 1024 / 1024} MB.` };
    }
    const key = f.name.toLowerCase();
    if (seen.has(key)) return { ok: false, message: `Two clips are named ${f.name}. Rename one.` };
    seen.add(key);
    clips.push({ index: clips.length, name: f.name, size });
  }
  const within = checkGameLimits(limits, existing, now);
  return within.ok ? { ok: true, value: clips } : within;
}

/** Whole-game videos (a half, a game) the coach picked, checked the same way. */
export function checkNewVideoJob(
  files: unknown,
  limits: TierLimits["film"],
  existing: FilmJob[],
  now: number,
): Checked<JobVideo[]> {
  if (!Array.isArray(files) || files.length === 0) return { ok: false, message: "Pick the game video to upload." };
  if (files.length > MAX_VIDEOS) return { ok: false, message: `Up to ${MAX_VIDEOS} videos at once (a game in halves or quarters); you picked ${files.length}.` };
  const seen = new Set<string>();
  const videos: JobVideo[] = [];
  for (const f of files as { name?: unknown; size?: unknown; read?: unknown }[]) {
    if (!isValidClipName(f?.name)) {
      return { ok: false, message: `"${String(f?.name).slice(0, 60)}" isn't a video the analyzer can read. Use .mp4, .mov or .m4v files with plain names.` };
    }
    const size = Number(f.size);
    if (!Number.isFinite(size) || size <= 0) return { ok: false, message: `${f.name} is empty.` };
    if (size > MAX_VIDEO_BYTES) {
      return { ok: false, message: `${f.name} is ${(size / 1024 / 1024 / 1024).toFixed(1)} GB. A video can be up to ${MAX_VIDEO_BYTES / 1024 / 1024 / 1024} GB; split it into halves.` };
    }
    const key = f.name.toLowerCase();
    if (seen.has(key)) return { ok: false, message: `Two videos are named ${f.name}. Rename one.` };
    seen.add(key);
    videos.push({ index: videos.length, name: f.name, size, read: f.read !== false });
  }
  const within = checkGameLimits(limits, existing, now);
  return within.ok ? { ok: true, value: videos } : within;
}

/** One video's plays as the worker reported them, checked before anything is cut or sent anywhere. */
export interface SplitPlay {
  start: number;
  snap: number;
  end: number;
  score: number;
}
export interface SplitReport {
  index: number;
  duration: number;
  plays: SplitPlay[];
}

const MAX_PLAYS_PER_VIDEO = 400;
const MAX_PLAY_SECONDS = 40;

export function cleanSplit(index: unknown, duration: unknown, plays: unknown): SplitReport | null {
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= MAX_VIDEOS) return null;
  const length = Number(duration);
  if (!Number.isFinite(length) || length <= 0 || !Array.isArray(plays)) return null;
  const clean: SplitPlay[] = [];
  for (const p of plays.slice(0, MAX_PLAYS_PER_VIDEO) as Partial<SplitPlay>[]) {
    const { start, snap, end, score } = { start: Number(p?.start), snap: Number(p?.snap), end: Number(p?.end), score: Number(p?.score) };
    if (![start, snap, end].every(Number.isFinite)) continue;
    if (start < 0 || !(start < snap && snap < end) || end > length + 5 || end - start > MAX_PLAY_SECONDS) continue;
    clean.push({ start, snap, end, score: Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0 });
  }
  clean.sort((a, b) => a.snap - b.snap);
  return { index: index as number, duration: length, plays: clean };
}

/**
 * The split of every video becomes one numbered list of plays to read. Videos that turn out to be other angles of the same
 * game (their snaps line up, see pairing.ts) are grouped, and only the video marked as the press box is read: the other angle
 * recognizes each play (so it isn't counted twice) and shows where the press box missed one, which is then cut from the press-box
 * recording at the same moment. Different parts of a game (halves) are kept apart and numbered in upload order.
 */
export function planGame(reports: SplitReport[], maxPlays: number, read: ReadonlySet<number> = new Set()): Checked<{ clips: JobClip[]; summary: PlanSummary }> {
  const groups = groupVideos(reports.map((r) => ({ index: r.index, snaps: r.plays.map((p) => p.snap) })), read);
  const byVideo = new Map(reports.map((r) => [r.index, r]));
  const clips: JobClip[] = [];
  const summary: PlanSummary = { plays: 0, matched: 0, recovered: 0, skipped: 0, otherAngles: 0, readAlone: 0 };
  for (const g of groups) {
    const main = byVideo.get(g.primary)!;
    summary.otherAngles += g.videos.length - 1;
    // A video marked "other angle" that found no press box to go with was read on its own, and the coach should be told.
    if (read.size > 0 && !read.has(g.primary)) summary.readAlone++;
    for (const play of g.plays) {
      const own = play.views.find((v) => v.video === g.primary);
      let source: { video: number; start: number; end: number };
      if (own) {
        const p = main.plays[own.snap];
        source = { video: main.index, start: p.start, end: p.end };
        if (play.views.length > 1) summary.matched++;
      } else {
        // Only the other angle saw it: the same moment in the press-box recording, if that recording covers it.
        const seen = play.views[0];
        const q = byVideo.get(seen.video)!.plays[seen.snap];
        const shift = g.toPrimary[seen.video] ?? 0;
        const start = q.start + shift;
        const end = q.end + shift;
        if (start < 0 || end > main.duration + 1) {
          summary.skipped++;
          continue;
        }
        source = { video: main.index, start, end };
        summary.recovered++;
      }
      const n = clips.length;
      clips.push({ index: n, name: clipName(n + 1), size: 0, source });
    }
  }
  if (clips.length === 0) {
    return { ok: false, message: "No plays were found in the video. Check that it shows the field, with the offense lined up before each snap." };
  }
  if (clips.length > maxPlays) {
    return { ok: false, message: `The video has ${clips.length} plays, more than the ${maxPlays} your plan allows in a game. Upload it in halves.` };
  }
  summary.plays = clips.length;
  return { ok: true, value: { clips, summary } };
}

/** `play_007.mp4`: the number is what the app lines a clip up with a sheet's row by. */
export function clipName(play: number): string {
  return `play_${String(play).padStart(3, "0")}.mp4`;
}

/** Clips split into dispatches of `size`, in order. */
export function planShards<T>(items: T[], size: number = SHARD_SIZE): T[][] {
  const shards: T[][] = [];
  for (let i = 0; i < items.length; i += size) shards.push(items.slice(i, i + size));
  return shards;
}

/* ------------------------------------------------------------------ what the coach sees */

export function viewOf(job: FilmJob, statuses: ClipStatus[]): JobView {
  const total = job.clips.length;
  const byIndex = new Map(statuses.map((s) => [s.index, s]));
  const reported = job.clips.filter((c) => byIndex.has(c.index)).length;
  const bad = (kind: ClipStatusKind) =>
    job.clips.flatMap((c) => {
      const s = byIndex.get(c.index);
      return s && s.status === kind ? [{ name: c.name, reason: s.reason }] : [];
    });
  const read = job.clips.filter((c) => byIndex.get(c.index)?.status === "done").length;
  const stage: JobView["stage"] =
    job.state === "uploading" ? "uploading"
    : job.state === "ready" ? "ready"
    : job.state === "failed" ? "failed"
    : total === 0 ? "splitting"
    : reported >= total ? "building" : "reading";
  return {
    id: job.id,
    state: job.state,
    createdAt: job.createdAt,
    total,
    reported,
    read,
    needsHand: bad("needs_hand"),
    failed: bad("failed"),
    stage,
    kind: job.kind ?? "clips",
    videos: job.videos?.length ?? 0,
    plan: job.plan,
    plays: job.plays,
    error: job.error,
    name: job.name ?? "",
    ...(job.saved ? { saved: job.saved } : {}),
    filmDeletedAt: job.clipsDeletedAt ?? null,
    filmExpiresAt: job.clipsDeletedAt ? null : new Date(Date.parse(job.createdAt) + CLIP_RETENTION_DAYS * DAY).toISOString(),
  };
}

/** Every clip has reported and at least one was read: time to build the cards. */
export function readyToAssemble(job: FilmJob, statuses: ClipStatus[]): "assemble" | "fail" | "wait" {
  if (job.state !== "processing" || job.clips.length === 0) return "wait";
  const reported = new Set(statuses.map((s) => s.index));
  if (!job.clips.every((c) => reported.has(c.index))) return "wait";
  return statuses.some((s) => s.status === "done") ? "assemble" : "fail";
}

/* ------------------------------------------------------------------ deleting the film */

export type Cleanup = "keep" | "delete-film" | "delete-all" | "mark-stuck";

/** What retention does to a job at `now`. The game file is never deleted by retention. */
export function cleanupFor(job: FilmJob, now: number): Cleanup {
  const age = now - Date.parse(job.createdAt);
  if (job.state === "uploading") return age > ABANDONED_UPLOAD_DAYS * DAY ? "delete-all" : "keep";
  if (job.state === "processing" && now - Date.parse(job.updatedAt) > STUCK_JOB_HOURS * HOUR) return "mark-stuck";
  if (job.clipsDeletedAt) return "keep";
  if (job.state === "processing") return "keep";
  return age > CLIP_RETENTION_DAYS * DAY ? "delete-film" : "keep";
}

/**
 * Usage limits per access tier for the AI routes. Two tiers:
 *
 * - `demo`: a coach on the free allow-list (`AI_ALLOWED_EMAILS`, see
 *   entitlement.ts) or the local/preview test bypass.
 * - `paid`: a coaching staff (Clerk org) with an active subscription.
 *
 * Everyone else gets no AI access at all (entitlement.ts answers 401/402/403
 * before any limit is checked). Enforced by src/lib/rateLimit.ts.
 */

export type AccessTier = "demo" | "paid";

export interface WindowLimit {
  limit: number;
  windowMs: number;
}

export interface TierLimits {
  /** `/api/generate-scout-card`: AI text cards. */
  cards: WindowLimit;
  /** `/api/parse-video`: single clips. */
  clips: WindowLimit;
  /** `/api/parse-video-batch`: games (jobs) running at once, and plays in one job. */
  batch: { activeJobs: number; maxPlays: number };
  /** `/api/review-import`: AI reviews of a CSV import's unplaced rows (one per import). */
  reviews: WindowLimit;
  /**
   * `/api/blob-upload`: clip uploads, for both flows. Sized to fit the clip
   * limit plus every running job's full game, so a batch never stalls on
   * uploads partway through.
   */
  uploads: WindowLimit;
}

const MINUTE = 60 * 1000;

export const TIER_LIMITS: Record<AccessTier, TierLimits> = {
  demo: {
    cards: { limit: 20, windowMs: MINUTE },
    clips: { limit: 10, windowMs: 5 * MINUTE },
    batch: { activeJobs: 1, maxPlays: 50 },
    reviews: { limit: 10, windowMs: 5 * MINUTE },
    uploads: { limit: 10 + 1 * 50, windowMs: 5 * MINUTE },
  },
  paid: {
    cards: { limit: 120, windowMs: MINUTE },
    clips: { limit: 50, windowMs: 5 * MINUTE },
    batch: { activeJobs: 3, maxPlays: 100 },
    reviews: { limit: 60, windowMs: 5 * MINUTE },
    uploads: { limit: 50 + 3 * 100, windowMs: 5 * MINUTE },
  },
};

/**
 * A job that hasn't sent a chunk in this long counts as finished even without
 * its final chunk (a closed tab, a lost connection), so it can't hold a slot
 * forever. Chunks of a live job arrive a minute or two apart.
 */
export const BATCH_JOB_IDLE_MS = 15 * MINUTE;

/** A job id from the client: short, url-safe, random. */
export function isValidJobId(jobId: unknown): jobId is string {
  return typeof jobId === "string" && /^[a-z0-9-]{8,48}$/.test(jobId);
}

/**
 * One chunk of a batch job, as a marker blob name:
 * `<jobId>/<timestamp>-<clips>[-done]`.
 */
export function batchMarkerName(jobId: string, at: number, clips: number, done: boolean): string {
  return `${jobId}/${at}-${clips}${done ? "-done" : ""}`;
}

export interface BatchJobSummary {
  jobId: string;
  plays: number;
  lastAt: number;
  done: boolean;
}

/** Rolls chunk markers up into one line per job (names relative to the team's prefix). */
export function summarizeBatchJobs(markerNames: string[]): BatchJobSummary[] {
  const jobs = new Map<string, BatchJobSummary>();
  for (const name of markerNames) {
    const m = name.match(/^([a-z0-9-]+)\/(\d+)-(\d+)(-done)?$/);
    if (!m) continue;
    const [, jobId, at, clips, done] = m;
    const job = jobs.get(jobId) ?? { jobId, plays: 0, lastAt: 0, done: false };
    job.plays += Number(clips);
    job.lastAt = Math.max(job.lastAt, Number(at));
    job.done ||= Boolean(done);
    jobs.set(jobId, job);
  }
  return [...jobs.values()];
}

export type BatchDecision = { ok: true } | { ok: false; message: string };

/**
 * Whether one more chunk of `clips` plays may run for `jobId`: a new job needs
 * a free slot (finished and idle jobs don't count), and no job may go past
 * the tier's plays per batch.
 */
export function decideBatchChunk(
  jobs: BatchJobSummary[],
  jobId: string,
  clips: number,
  totalPlays: number,
  limits: TierLimits["batch"],
  now: number,
): BatchDecision {
  const mine = jobs.find((j) => j.jobId === jobId);
  if (mine?.done) return { ok: false, message: "This batch already finished. Start a new one." };
  if (!mine) {
    if (totalPlays > limits.maxPlays) {
      return {
        ok: false,
        message: `A batch can have at most ${limits.maxPlays} plays; this one has ${totalPlays}. Split the game into two uploads.`,
      };
    }
    const active = jobs.filter((j) => !j.done && now - j.lastAt < BATCH_JOB_IDLE_MS);
    if (active.length >= limits.activeJobs) {
      return {
        ok: false,
        message: `Your staff already has ${active.length} ${active.length === 1 ? "batch" : "batches"} running (limit ${limits.activeJobs} at a time). Try again when ${active.length === 1 ? "it finishes" : "one finishes"}.`,
      };
    }
  }
  if ((mine?.plays ?? 0) + clips > limits.maxPlays) {
    return { ok: false, message: `A batch can have at most ${limits.maxPlays} plays.` };
  }
  return { ok: true };
}

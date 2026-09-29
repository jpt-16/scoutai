import { describe, expect, it } from "vitest";
import {
  BATCH_JOB_IDLE_MS,
  batchMarkerName,
  decideBatchChunk,
  isValidJobId,
  summarizeBatchJobs,
  TIER_LIMITS,
} from "./usageLimits";

describe("TIER_LIMITS", () => {
  it("matches the demo / paid table", () => {
    expect(TIER_LIMITS.demo.cards).toEqual({ limit: 20, windowMs: 60_000 });
    expect(TIER_LIMITS.paid.cards).toEqual({ limit: 120, windowMs: 60_000 });
    expect(TIER_LIMITS.demo.clips).toEqual({ limit: 10, windowMs: 300_000 });
    expect(TIER_LIMITS.paid.clips).toEqual({ limit: 50, windowMs: 300_000 });
    expect(TIER_LIMITS.demo.batch).toEqual({ activeJobs: 1, maxPlays: 50 });
    expect(TIER_LIMITS.paid.batch).toEqual({ activeJobs: 3, maxPlays: 100 });
  });

  it("allows enough uploads for the clip limit plus every running game", () => {
    for (const t of Object.values(TIER_LIMITS)) {
      expect(t.uploads.limit).toBeGreaterThanOrEqual(t.clips.limit + t.batch.activeJobs * t.batch.maxPlays);
    }
  });
});

describe("batch jobs", () => {
  const now = 1_000_000_000;
  const limits = TIER_LIMITS.demo.batch;

  it("rolls chunk markers up per job", () => {
    const jobs = summarizeBatchJobs([
      batchMarkerName("job-aaaaaaaa", now - 5000, 10, false),
      batchMarkerName("job-aaaaaaaa", now - 1000, 10, false),
      batchMarkerName("job-bbbbbbbb", now - 900, 4, true),
      "junk",
    ]);
    expect(jobs).toEqual([
      { jobId: "job-aaaaaaaa", plays: 20, lastAt: now - 1000, done: false },
      { jobId: "job-bbbbbbbb", plays: 4, lastAt: now - 900, done: true },
    ]);
  });

  it("lets a running job keep going but blocks a second one on the demo tier", () => {
    const jobs = summarizeBatchJobs([batchMarkerName("job-aaaaaaaa", now - 1000, 10, false)]);
    expect(decideBatchChunk(jobs, "job-aaaaaaaa", 10, 40, limits, now)).toEqual({ ok: true });
    const second = decideBatchChunk(jobs, "job-cccccccc", 10, 20, limits, now);
    expect(second.ok).toBe(false);
    // Paid staffs run up to 3 at once.
    expect(decideBatchChunk(jobs, "job-cccccccc", 10, 20, TIER_LIMITS.paid.batch, now)).toEqual({ ok: true });
  });

  it("frees the slot when a job finishes or goes idle", () => {
    const done = summarizeBatchJobs([batchMarkerName("job-aaaaaaaa", now - 1000, 10, true)]);
    expect(decideBatchChunk(done, "job-cccccccc", 10, 20, limits, now)).toEqual({ ok: true });
    expect(decideBatchChunk(done, "job-aaaaaaaa", 10, 20, limits, now).ok).toBe(false);
    const idle = summarizeBatchJobs([batchMarkerName("job-aaaaaaaa", now - BATCH_JOB_IDLE_MS - 1, 10, false)]);
    expect(decideBatchChunk(idle, "job-cccccccc", 10, 20, limits, now)).toEqual({ ok: true });
  });

  it("caps plays per batch, up front and chunk by chunk", () => {
    const tooBig = decideBatchChunk([], "job-aaaaaaaa", 10, 51, limits, now);
    expect(tooBig).toMatchObject({ ok: false, message: expect.stringMatching(/at most 50 plays/) });
    const jobs = summarizeBatchJobs([batchMarkerName("job-aaaaaaaa", now - 1000, 45, false)]);
    expect(decideBatchChunk(jobs, "job-aaaaaaaa", 10, 50, limits, now).ok).toBe(false);
    expect(decideBatchChunk(jobs, "job-aaaaaaaa", 5, 50, limits, now)).toEqual({ ok: true });
  });

  it("only accepts short url-safe job ids", () => {
    expect(isValidJobId("job-lx2k9-abc12345")).toBe(true);
    expect(isValidJobId("../../x")).toBe(false);
    expect(isValidJobId(42)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { TIER_LIMITS } from "../usageLimits";
import {
  ABANDONED_UPLOAD_DAYS,
  CLIP_RETENTION_DAYS,
  MAX_CLIP_BYTES,
  MAX_VIDEOS,
  MAX_VIDEO_BYTES,
  STUCK_JOB_HOURS,
  checkNewJob,
  checkNewVideoJob,
  cleanSplit,
  parseVideoPath,
  planClips,
  cleanupFor,
  isValidClipName,
  isValidJobId,
  newJobId,
  parseClipPath,
  parseJobPath,
  parseStatusPath,
  paths,
  planShards,
  readyToAssemble,
  teamKey,
  verifyWorkerToken,
  viewOf,
  workerToken,
  type ClipStatus,
  type FilmJob,
} from "./jobs";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-20T12:00:00Z");
const limits = TIER_LIMITS.demo.film;
const team = teamKey("org_abc");
const id = newJobId();

const job = (patch: Partial<FilmJob> = {}): FilmJob => ({
  id,
  state: "processing",
  createdAt: new Date(NOW - HOUR).toISOString(),
  updatedAt: new Date(NOW - HOUR).toISOString(),
  clips: [0, 1, 2].map((i) => ({ index: i, name: `play_${i + 1}.mp4`, size: 1000 })),
  ...patch,
});

const status = (index: number, kind: ClipStatus["status"], reason = ""): ClipStatus => ({
  index, name: `play_${index + 1}.mp4`, status: kind, reason, formation: "trips", strength: "right", seconds: 40, at: "",
});

describe("names, ids and paths", () => {
  it("makes ids and team keys the validators accept, and never lets a path name the team", () => {
    expect(isValidJobId(newJobId())).toBe(true);
    expect(isValidJobId("../etc")).toBe(false);
    expect(team).toMatch(/^[0-9a-f]{24}$/);
    expect(team).not.toContain("org_abc");
    expect(teamKey("org_abc")).toBe(team);
    expect(teamKey("org_other")).not.toBe(team);
  });

  it("accepts bare video file names and nothing that could climb out of a folder", () => {
    for (const ok of ["play_03.mp4", "Play 3 (1).MOV", "03-slant.m4v"]) expect(isValidClipName(ok)).toBe(true);
    for (const bad of ["../x.mp4", "a/b.mp4", ".hidden.mp4", "play.avi", "play.mp4.exe", "", "a..b.mp4", 5, null]) {
      expect(isValidClipName(bad as string)).toBe(false);
    }
  });

  it("reads a clip path back to its parts, and refuses any other shape", () => {
    const p = paths.clip(team, id, 7, "play_08.mp4");
    expect(parseClipPath(p)).toEqual({ team, job: id, index: 7, name: "play_08.mp4" });
    expect(parseClipPath(`film/${team}/${id}/clips/7/../../x.mp4`)).toBeNull();
    expect(parseClipPath(`film/${team}/${id}/tracks/7.json`)).toBeNull();
    expect(parseClipPath(`film/../${id}/clips/7/a.mp4`)).toBeNull();
  });

  it("reads job and status paths back", () => {
    expect(parseJobPath(paths.job(team, id))).toEqual({ team, job: id });
    expect(parseJobPath(`filmjobs/${team}/${id}/x.json`)).toBeNull();
    expect(parseStatusPath(paths.status(team, id, 12, "needs_hand"))).toEqual({ index: 12, kind: "needs_hand" });
    expect(parseStatusPath(`film/${team}/${id}/status/12-bogus.json`)).toBeNull();
  });
});

describe("the worker's token", () => {
  it("is tied to one job of one team", () => {
    const t = workerToken("s3cret", team, id);
    expect(verifyWorkerToken("s3cret", team, id, t)).toBe(true);
    expect(verifyWorkerToken("s3cret", team, newJobId(), t)).toBe(false);
    expect(verifyWorkerToken("s3cret", teamKey("org_other"), id, t)).toBe(false);
    expect(verifyWorkerToken("other", team, id, t)).toBe(false);
    expect(verifyWorkerToken("s3cret", team, id, null)).toBe(false);
    expect(verifyWorkerToken("s3cret", team, id, "short")).toBe(false);
  });

  it("is never accepted when no secret is configured", () => {
    expect(verifyWorkerToken(undefined, team, id, workerToken("", team, id))).toBe(false);
    expect(verifyWorkerToken("", team, id, workerToken("", team, id))).toBe(false);
  });
});

describe("checking a new game", () => {
  const files = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `play_${i + 1}.mp4`, size: 5_000_000 }));

  it("numbers the clips in the order they were picked", () => {
    const r = checkNewJob(files(3), limits, [], NOW);
    expect(r.ok && r.value.map((c) => [c.index, c.name])).toEqual([[0, "play_1.mp4"], [1, "play_2.mp4"], [2, "play_3.mp4"]]);
  });

  it.each([
    ["nothing picked", [], /Pick the clips/],
    ["not a list", "x", /Pick the clips/],
    ["a bad name", [{ name: "../x.mp4", size: 10 }], /isn't a clip/],
    ["an empty file", [{ name: "a.mp4", size: 0 }], /empty/],
    ["a huge file", [{ name: "a.mp4", size: MAX_CLIP_BYTES + 1 }], /MB/],
    ["a repeated name, in any case", [{ name: "a.mp4", size: 5 }, { name: "A.MP4", size: 5 }], /Two clips/],
  ])("refuses %s", (_label, input, message) => {
    const r = checkNewJob(input, limits, [], NOW);
    expect(!r.ok && r.message).toMatch(message);
  });

  it("refuses more plays than the tier allows", () => {
    expect(checkNewJob(files(limits.maxPlays), limits, [], NOW).ok).toBe(true);
    const r = checkNewJob(files(limits.maxPlays + 1), limits, [], NOW);
    expect(!r.ok && r.message).toMatch(/at most 150/);
  });

  it("allows only so many games at once, but a stale one doesn't hold a slot", () => {
    const busy = job({ state: "processing" });
    expect(checkNewJob(files(2), limits, [busy], NOW).ok).toBe(false);
    const stale = job({ state: "processing", updatedAt: new Date(NOW - (STUCK_JOB_HOURS + 1) * HOUR).toISOString() });
    expect(checkNewJob(files(2), limits, [stale], NOW).ok).toBe(true);
    expect(checkNewJob(files(2), limits, [job({ state: "ready" })], NOW).ok).toBe(true);
    expect(checkNewJob(files(2), TIER_LIMITS.paid.film, [busy], NOW).ok).toBe(true); // paid runs three at once
  });

  it("caps games a week, counting only the last seven days", () => {
    const week = Array.from({ length: limits.jobsPerWeek }, () => job({ state: "ready", createdAt: new Date(NOW - 2 * DAY).toISOString() }));
    const r = checkNewJob(files(2), limits, week, NOW);
    expect(!r.ok && r.message).toMatch(/last week/);
    const old = week.map((j) => ({ ...j, createdAt: new Date(NOW - 8 * DAY).toISOString() }));
    expect(checkNewJob(files(2), limits, old, NOW).ok).toBe(true);
  });
});

describe("shards", () => {
  it("splits in order and keeps the remainder", () => {
    expect(planShards([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(planShards([], 2)).toEqual([]);
    expect(planShards(Array.from({ length: 13 }, (_, i) => i)).map((s) => s.length)).toEqual([6, 6, 1]);
  });
});

describe("what the coach sees", () => {
  it("walks uploading, reading, building, ready", () => {
    expect(viewOf(job({ state: "uploading" }), []).stage).toBe("uploading");
    const reading = viewOf(job(), [status(0, "done")]);
    expect(reading).toMatchObject({ stage: "reading", reported: 1, read: 1, total: 3 });
    expect(viewOf(job(), [status(0, "done"), status(1, "done"), status(2, "done")]).stage).toBe("building");
    expect(viewOf(job({ state: "ready", plays: 3 }), []).stage).toBe("ready");
    expect(viewOf(job({ state: "failed", error: "x" }), [])).toMatchObject({ stage: "failed", error: "x" });
  });

  it("lists the clips that need a hand or failed, with their reasons, by name", () => {
    const v = viewOf(job(), [status(0, "done"), status(1, "needs_hand", "only 2 yard lines"), status(2, "failed", "boom")]);
    expect(v.needsHand).toEqual([{ name: "play_2.mp4", reason: "only 2 yard lines" }]);
    expect(v.failed).toEqual([{ name: "play_3.mp4", reason: "boom" }]);
    expect(v.read).toBe(1);
  });

  it("says when the film goes, and that it has gone once it has", () => {
    const fresh = viewOf(job(), []);
    expect(Date.parse(fresh.filmExpiresAt!) - Date.parse(fresh.createdAt)).toBe(CLIP_RETENTION_DAYS * DAY);
    const gone = viewOf(job({ state: "ready", clipsDeletedAt: "2026-11-01T00:00:00Z" }), []);
    expect(gone).toMatchObject({ filmDeletedAt: "2026-11-01T00:00:00Z", filmExpiresAt: null });
  });
});

describe("when to build the cards", () => {
  const all = [status(0, "done"), status(1, "needs_hand"), status(2, "done")];
  it("waits for every clip", () => {
    expect(readyToAssemble(job(), all.slice(0, 2))).toBe("wait");
  });
  it("builds once everyone has reported and at least one was read", () => {
    expect(readyToAssemble(job(), all)).toBe("assemble");
  });
  it("fails when nothing could be read", () => {
    expect(readyToAssemble(job(), [status(0, "needs_hand"), status(1, "failed"), status(2, "needs_hand")])).toBe("fail");
  });
  it("does nothing for a job that isn't processing", () => {
    expect(readyToAssemble(job({ state: "ready" }), all)).toBe("wait");
  });
});

describe("retention", () => {
  const at = (days: number) => new Date(NOW - days * DAY).toISOString();
  it("keeps recent film and deletes it after the retention", () => {
    expect(cleanupFor(job({ state: "ready", createdAt: at(CLIP_RETENTION_DAYS - 1) }), NOW)).toBe("keep");
    expect(cleanupFor(job({ state: "ready", createdAt: at(CLIP_RETENTION_DAYS + 1) }), NOW)).toBe("delete-film");
    expect(cleanupFor(job({ state: "failed", createdAt: at(CLIP_RETENTION_DAYS + 1) }), NOW)).toBe("delete-film");
  });
  it("does it once", () => {
    expect(cleanupFor(job({ state: "ready", createdAt: at(30), clipsDeletedAt: at(10) }), NOW)).toBe("keep");
  });
  it("removes an upload nobody finished, but not a fresh one", () => {
    expect(cleanupFor(job({ state: "uploading", createdAt: at(ABANDONED_UPLOAD_DAYS + 1) }), NOW)).toBe("delete-all");
    expect(cleanupFor(job({ state: "uploading", createdAt: at(1) }), NOW)).toBe("keep");
  });
  it("marks a game the worker never finished as failed", () => {
    const old = new Date(NOW - (STUCK_JOB_HOURS + 1) * HOUR).toISOString();
    expect(cleanupFor(job({ state: "processing", updatedAt: old }), NOW)).toBe("mark-stuck");
    expect(cleanupFor(job({ state: "processing" }), NOW)).toBe("keep");
  });
});


describe("a whole game's video", () => {
  const video = (name: string, gb = 2) => ({ name, size: gb * 1024 * 1024 * 1024 });

  it("takes up to a few videos, numbered in the order picked", () => {
    const r = checkNewVideoJob([video("first_half.mp4"), video("second_half.mp4")], limits, [], NOW);
    expect(r.ok && r.value.map((v) => [v.index, v.name])).toEqual([[0, "first_half.mp4"], [1, "second_half.mp4"]]);
  });

  it.each([
    ["nothing picked", [], /Pick the game video/],
    ["too many", Array.from({ length: MAX_VIDEOS + 1 }, (_, i) => video(`h${i}.mp4`)), /Up to 4 videos/],
    ["a bad name", [{ name: "../x.mp4", size: 5 }], /isn't a video/],
    ["an empty file", [{ name: "a.mp4", size: 0 }], /empty/],
    ["too large", [{ name: "a.mp4", size: MAX_VIDEO_BYTES + 1 }], /GB.*halves/],
    ["a repeated name", [video("a.mp4"), video("A.MP4")], /Two videos/],
  ])("refuses %s", (_label, input, message) => {
    const r = checkNewVideoJob(input, limits, [], NOW);
    expect(!r.ok && r.message).toMatch(message);
  });

  it("counts against the same games-at-once and games-a-week limits as clips", () => {
    expect(checkNewVideoJob([video("a.mp4")], limits, [job({ state: "processing" })], NOW).ok).toBe(false);
    const week = Array.from({ length: limits.jobsPerWeek }, () => job({ state: "ready" }));
    expect(checkNewVideoJob([video("a.mp4")], limits, week, NOW).ok).toBe(false);
  });

  it("has its own upload path, read back the same way", () => {
    const p = paths.video(team, id, 1, "second_half.mp4");
    expect(parseVideoPath(p)).toEqual({ team, job: id, index: 1, name: "second_half.mp4" });
    expect(parseClipPath(p)).toBeNull();
    expect(parseVideoPath(paths.clip(team, id, 1, "a.mp4"))).toBeNull();
    expect(parseVideoPath(`film/${team}/${id}/videos/1/../../x.mp4`)).toBeNull();
  });

  it("is 'splitting' while the worker looks for the plays, then reads like any game", () => {
    const waiting = job({ kind: "video", videos: [{ index: 0, name: "a.mp4", size: 5 }], clips: [] });
    expect(viewOf(waiting, [])).toMatchObject({ stage: "splitting", kind: "video", videos: 1, total: 0 });
    expect(readyToAssemble(waiting, [])).toBe("wait"); // nothing to assemble before there are plays
    expect(viewOf(job({ kind: "video", videos: [{ index: 0, name: "a.mp4", size: 5 }] }), []).stage).toBe("reading");
  });
});

describe("the plays the worker found", () => {
  const play = (start: number, snap: number, end: number, score = 0.9) => ({ start, snap, end, score });

  it("keeps good plays in time order and drops the nonsense", () => {
    const r = cleanSplit(0, 3600, [
      play(300, 303, 312),
      play(10, 13, 22),
      play(-5, 3, 12), // before the film
      play(50, 49, 60), // snap before the start
      play(100, 103, 4000), // past the end
      play(200, 203, 260), // far too long for a play
      { start: "a", snap: 1, end: 2 },
      null,
      play(400, 403, 410, 7), // score clamped
    ]);
    expect(r?.plays.map((p) => p.snap)).toEqual([13, 303, 403]);
    expect(r?.plays.at(-1)?.score).toBe(1);
  });

  it("refuses a report that isn't one", () => {
    expect(cleanSplit(-1, 100, [])).toBeNull();
    expect(cleanSplit(MAX_VIDEOS, 100, [])).toBeNull();
    expect(cleanSplit(0, 0, [])).toBeNull();
    expect(cleanSplit(0, 100, "plays")).toBeNull();
    expect(cleanSplit("0", 100, [])).toBeNull();
  });

  it("numbers the plays across the videos in video order, whatever order the reports came in", () => {
    const second = cleanSplit(1, 3000, [play(5, 8, 17)])!;
    const first = cleanSplit(0, 3000, [play(30, 33, 42), play(90, 93, 102)])!;
    const r = planClips([second, first], 150);
    expect(r.ok && r.value.map((c) => [c.name, c.source])).toEqual([
      ["play_001.mp4", { video: 0, start: 30, end: 42 }],
      ["play_002.mp4", { video: 0, start: 90, end: 102 }],
      ["play_003.mp4", { video: 1, start: 5, end: 17 }],
    ]);
    expect(r.ok && r.value.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it("fails clearly when there are no plays, or more than the plan allows", () => {
    expect(planClips([cleanSplit(0, 100, [])!], 150)).toMatchObject({ ok: false, message: expect.stringMatching(/No plays were found/) });
    const many = cleanSplit(0, 4000, Array.from({ length: 60 }, (_, i) => play(i * 20, i * 20 + 3, i * 20 + 12)))!;
    expect(planClips([many], 50)).toMatchObject({ ok: false, message: expect.stringMatching(/60 plays, more than the 50/) });
    expect(planClips([many], 60).ok).toBe(true);
  });
});

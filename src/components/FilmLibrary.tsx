"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Film, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { filmApi } from "@/lib/film/client";
import type { JobView } from "@/lib/film/jobs";
import { CLIP_RETENTION_DAYS, MAX_CLIP_BYTES, MAX_VIDEOS, MAX_VIDEO_BYTES, isValidClipName } from "@/lib/film/shared";
import { formatBytes, runUploads, type UploadItem, type UploadProgress } from "@/lib/film/uploadPlan";
import { parseScriptFile, storeScript } from "@/lib/scriptStore";
import { cn } from "@/lib/utils";

/**
 * Game film: pick a game's clips, upload them, watch them being read, open the scout cards.
 * The film goes straight to private storage and is deleted `CLIP_RETENTION_DAYS` days later; the scout
 * cards stay (src/lib/film/*, video-service/eval/worker.py).
 */

const POLL_MS = 5000;
const VIDEO = /\.(mp4|mov|m4v)$/i;

interface Pending {
  id: string;
  items: UploadItem[];
  files: File[];
}

/** A guess at which video is the press box from its name (the coach can change it): "end zone" is not, "press"/"box" is, else the first. */
function guessPressBox(name: string, index: number): boolean {
  const n = name.toLowerCase();
  if (/end[\s_-]*zone|endzone|(^|[\s_-])(ez|end)([\s_.-]|$)/.test(n)) return false;
  if (/press|box|sideline|high/.test(n)) return true;
  return index === 0;
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function FilmLibrary() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"clips" | "video">("clips");
  const [picked, setPicked] = useState<File[]>([]);
  /** For a game picked as several videos: which one is the press box (read); the rest are other angles, used only to match plays. */
  const [reads, setReads] = useState<boolean[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState<"idle" | "creating" | "uploading" | "starting">("idle");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [failedClips, setFailedClips] = useState<{ name: string; message: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setJobs(await filmApi.list());
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While a game is being read, ask how far it has got.
  const active = jobs?.some((j) => j.stage === "splitting" || j.stage === "reading" || j.stage === "building") ?? false;
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => void refresh(), POLL_MS);
    return () => clearTimeout(timer);
  }, [active, jobs, refresh]);

  function switchMode(next: "clips" | "video") {
    if (working || next === mode) return;
    setMode(next);
    setPicked([]);
    setReads([]);
    setSkipped([]);
    setError(null);
    setFailedClips([]);
    setPending(null);
  }

  function pick(list: FileList | null) {
    const all = Array.from(list ?? []);
    const videos = all.filter((f) => VIDEO.test(f.name));
    setSkipped(all.filter((f) => !VIDEO.test(f.name)).map((f) => f.name));
    setPicked(videos);
    setReads(videos.map((f, i) => guessPressBox(f.name, i)));
    setError(null);
    setFailedClips([]);
    setPending(null);
  }

  const badNames = picked.filter((f) => !isValidClipName(f.name)).map((f) => f.name);
  const sizeLimit = mode === "video" ? MAX_VIDEO_BYTES : MAX_CLIP_BYTES;
  const tooBig = picked.filter((f) => f.size > sizeLimit).map((f) => f.name);
  const tooMany = mode === "video" && picked.length > MAX_VIDEOS;
  const total = picked.reduce((sum, f) => sum + f.size, 0);

  async function sendAll(job: Pending) {
    setBusy("uploading");
    const { upload } = await import("@vercel/blob/client");
    const outcome = await runUploads(
      job.items,
      async (item, onBytes) => {
        await upload(item.pathname, job.files[item.index], {
          access: "private",
          handleUploadUrl: "/api/film/upload",
          multipart: mode === "video" || item.size > 8 * 1024 * 1024,
          onUploadProgress: ({ loaded }) => onBytes(loaded),
        });
      },
      { onProgress: setProgress },
    );
    if (outcome.failed.length) {
      // Keep the game open so only the clips that dropped need sending again.
      const failedNames = new Set(outcome.failed.map((f) => f.name));
      setPending({ ...job, items: job.items.filter((i) => failedNames.has(i.name)) });
      setFailedClips(outcome.failed);
      setBusy("idle");
      return;
    }
    setBusy("starting");
    await filmApi.start(job.id);
    setPending(null);
    setPicked([]);
    setProgress(null);
    setBusy("idle");
    await refresh();
  }

  async function begin() {
    setError(null);
    setFailedClips([]);
    try {
      setBusy("creating");
      const { job, uploads } = await filmApi.create(picked.map((f, i) => ({ name: f.name, size: f.size, ...(mode === "video" ? { read: reads[i] ?? true } : {}) })), mode);
      const items: UploadItem[] = uploads.map((u) => ({ index: u.index, name: u.name, pathname: u.pathname, size: picked[u.index].size }));
      await sendAll({ id: job.id, items, files: picked });
    } catch (e) {
      setError((e as Error).message);
      setBusy("idle");
      await refresh();
    }
  }

  async function retry() {
    if (!pending) return;
    setError(null);
    setFailedClips([]);
    try {
      await sendAll(pending);
    } catch (e) {
      setError((e as Error).message);
      setBusy("idle");
      await refresh();
    }
  }

  async function open(job: JobView) {
    setOpening(job.id);
    try {
      const game = parseScriptFile(await filmApi.gameText(job.id));
      if (!game) throw new Error("That game file couldn't be read.");
      storeScript(game);
      router.push("/script?loaded=1");
    } catch (e) {
      setError((e as Error).message);
      setOpening(null);
    }
  }

  async function remove(job: JobView) {
    if (!window.confirm("Delete this game, its film and its scout cards? This can't be undone.")) return;
    try {
      await filmApi.remove(job.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const working = busy !== "idle";
  const percent = progress && progress.bytesTotal ? Math.round((100 * progress.bytesDone) / progress.bytesTotal) : 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6">
      <section className="flex flex-col gap-4 rounded-3xl border bg-card p-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-3xl font-extrabold uppercase">Upload a game</h2>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            {mode === "clips"
              ? `Pick one game's clips, one per play (.mp4, .mov or .m4v, up to ${MAX_CLIP_BYTES / 1024 / 1024} MB each). `
              : `Pick the whole game as one recording, or in halves (up to ${MAX_VIDEOS} .mp4, .mov or .m4v files, ${MAX_VIDEO_BYTES / 1024 / 1024 / 1024} GB each). We find every snap and cut the plays ourselves. If you also have another angle (the end zone), pick it with the press-box video: we match the plays up so none is counted twice, and read the press-box film only. It reads best from a recording that shows the field, with the offense lined up and still before each snap. `}
            We read every play and build the scout cards. The film is deleted {CLIP_RETENTION_DAYS} days after you upload it; the
            cards stay.
          </p>
        </div>

        <div className="inline-flex w-fit rounded-xl border p-1" role="group" aria-label="What are you uploading?">
          {(["clips", "video"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              disabled={working}
              onClick={() => switchMode(m)}
              className={cn(
                "min-h-11 rounded-lg px-4 text-sm font-bold transition-colors disabled:opacity-50",
                mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "clips" ? "Clips, one per play" : "Whole game video"}
            </button>
          ))}
        </div>

        <input
          ref={input}
          type="file"
          accept="video/mp4,video/quicktime,video/x-m4v,.mp4,.mov,.m4v"
          multiple
          className="sr-only"
          aria-label={mode === "video" ? "Choose the game video" : "Choose a game's clips"}
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="lg" disabled={working} onClick={() => input.current?.click()}>
            <Film aria-hidden="true" />
            {picked.length ? (mode === "video" ? "Choose a different video" : "Choose different clips") : mode === "video" ? "Choose the game video" : "Choose clips"}
          </Button>
          {picked.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {picked.length} {mode === "video" ? (picked.length === 1 ? "video" : "videos") : picked.length === 1 ? "clip" : "clips"} · {formatBytes(total)}
            </span>
          )}
        </div>

        {skipped.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Left out (not video files): {skipped.slice(0, 4).join(", ")}
            {skipped.length > 4 ? `, and ${skipped.length - 4} more` : ""}.
          </p>
        )}
        {badNames.length > 0 && (
          <p className="text-sm text-destructive" role="alert">
            Rename these before uploading (letters, numbers, spaces and . _ - ( ) + only): {badNames.slice(0, 4).join(", ")}
            {badNames.length > 4 ? `, and ${badNames.length - 4} more` : ""}.
          </p>
        )}
        {tooBig.length > 0 && (
          <p className="text-sm text-destructive" role="alert">
            Too large (over {mode === "video" ? `${MAX_VIDEO_BYTES / 1024 / 1024 / 1024} GB. Split it into halves` : `${MAX_CLIP_BYTES / 1024 / 1024} MB`}): {tooBig.slice(0, 4).join(", ")}.
          </p>
        )}
        {tooMany && (
          <p className="text-sm text-destructive" role="alert">
            Up to {MAX_VIDEOS} videos at once. Pick fewer.
          </p>
        )}

        {mode === "video" && picked.length > 1 && !pending && (
          <fieldset className="flex flex-col gap-2 rounded-2xl border p-4">
            <legend className="px-1 text-sm font-bold">Which one is the press box?</legend>
            <p className="text-sm text-muted-foreground">
              We read the press-box film. The other angle (the end zone, say) is only used to match each play, so a play isn&apos;t counted
              twice and one the press box missed can be found.
            </p>
            {picked.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold">{f.name}</span>
                <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label={`What is ${f.name}?`}>
                  {([true, false] as const).map((isRead) => (
                    <button
                      key={String(isRead)}
                      type="button"
                      aria-pressed={(reads[i] ?? true) === isRead}
                      disabled={working}
                      onClick={() => setReads((r) => picked.map((_, k) => (k === i ? isRead : r[k] ?? true)))}
                      className={cn(
                        "min-h-11 rounded-md px-3 text-xs font-bold transition-colors disabled:opacity-50",
                        (reads[i] ?? true) === isRead ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {isRead ? "Press box (read)" : "Other angle (not read)"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
        )}

        {picked.length > 0 && !pending && (
          <div>
            <Button size="xl" disabled={working || badNames.length > 0 || tooBig.length > 0 || tooMany} onClick={() => void begin()}>
              {working ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
              {busy === "creating" ? "Getting ready…" : busy === "starting" ? "Starting…" : busy === "uploading" ? `Uploading… ${percent}%` : `Upload ${picked.length} ${mode === "video" ? (picked.length === 1 ? "video" : "videos") : picked.length === 1 ? "clip" : "clips"}`}
            </Button>
          </div>
        )}

        {busy === "uploading" && progress && (
          <div className="flex flex-col gap-1.5" role="status">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-sm text-muted-foreground">
              {progress.filesDone} of {progress.filesTotal} {mode === "video" ? "videos" : "clips"} uploaded · keep this tab open until it finishes
            </p>
          </div>
        )}

        {failedClips.length > 0 && (
          <div className="flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4" role="alert">
            <p className="text-sm">
              {failedClips.length} {failedClips.length === 1 ? "clip" : "clips"} didn&apos;t upload: {failedClips.slice(0, 3).map((f) => f.name).join(", ")}
              {failedClips.length > 3 ? ", …" : ""}. {failedClips[0].message}
            </p>
            <div>
              <Button variant="outline" disabled={working} onClick={() => void retry()}>
                Try those again
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-2xl font-extrabold uppercase">Your games</h2>
        {loadError && (
          <p className="text-sm text-destructive" role="alert">
            {loadError}
          </p>
        )}
        {jobs === null && !loadError && <p className="text-muted-foreground">Loading…</p>}
        {jobs?.length === 0 && <p className="text-muted-foreground">No games yet. Upload one above.</p>}
        <ul className="flex flex-col gap-3">
          {jobs?.map((job) => (
            <li key={job.id}>
              <GameCard job={job} opening={opening === job.id} onOpen={() => void open(job)} onDelete={() => void remove(job)} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function GameCard({ job, opening, onOpen, onDelete }: { job: JobView; opening: boolean; onOpen: () => void; onDelete: () => void }) {
  const pct = job.total ? Math.round((100 * job.reported) / job.total) : 0;
  const unread = job.needsHand.length + job.failed.length;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-display text-xl font-bold">
            Game · {when(job.createdAt)}
          </span>
          <span className="text-sm text-muted-foreground">
            {job.kind === "video"
              ? `${job.videos} ${job.videos === 1 ? "video" : "videos"}${job.plan ? ` · ${job.plan.plays} plays found` : ""}`
              : `${job.total} ${job.total === 1 ? "clip" : "clips"}`}
          </span>
        </div>
        {job.stage === "ready" && (
          <Button size="lg" disabled={opening} onClick={onOpen}>
            {opening ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
            Open {job.plays ? `${job.plays} scout cards` : "scout cards"}
          </Button>
        )}
      </div>

      {job.stage === "uploading" && (
        <p className="text-sm text-muted-foreground">The upload didn&apos;t finish. Delete this and upload the game again.</p>
      )}
      {job.plan && job.plan.otherAngles > 0 && (
        <p className="text-sm text-muted-foreground">
          Matched {job.plan.otherAngles === 1 ? "the other angle" : `${job.plan.otherAngles} other angles`} to the press box: {job.plan.matched} of{" "}
          {job.plan.plays} plays were seen by both
          {job.plan.recovered > 0 ? `. The press box missed ${job.plan.recovered} ${job.plan.recovered === 1 ? "play" : "plays"}; ${job.plan.recovered === 1 ? "it was" : "they were"} found from the other angle and cut from the press-box film` : ""}
          {job.plan.skipped > 0 ? `. ${job.plan.skipped} more ${job.plan.skipped === 1 ? "play was" : "plays were"} only on the other angle, and the press-box recording doesn't reach ${job.plan.skipped === 1 ? "it" : "them"}` : ""}. Only the
          press box was read.
        </p>
      )}
      {job.plan && job.plan.readAlone > 0 && (
        <p className="text-sm text-muted-foreground">
          {job.plan.readAlone === 1 ? "A video marked \"other angle\" matched" : `${job.plan.readAlone} videos marked "other angle" matched`} no press-box video, so{" "}
          {job.plan.readAlone === 1 ? "it was" : "they were"} read on {job.plan.readAlone === 1 ? "its" : "their"} own.
        </p>
      )}
      {job.stage === "splitting" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Finding the plays in the video. This takes a few minutes.
        </p>
      )}
      {job.stage === "reading" && (
        <div className="flex flex-col gap-1.5" role="status">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm text-muted-foreground">Reading plays: {job.reported} of {job.total}</p>
        </div>
      )}
      {job.stage === "building" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Building the scout cards…
        </p>
      )}
      {job.stage === "failed" && (
        <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {job.error ?? "This game couldn't be processed."}
        </p>
      )}

      {unread > 0 && job.stage !== "uploading" && (
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">
            {unread} {unread === 1 ? "clip" : "clips"} couldn&apos;t be read
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {[...job.needsHand, ...job.failed].map((c) => (
              <li key={c.name}>
                <span className="font-semibold text-foreground">{c.name}</span>
                {c.reason ? `: ${c.reason}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-2">The field couldn&apos;t be found in these. Send them to us and we&apos;ll mark them by hand.</p>
        </details>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
        <span>{job.filmDeletedAt ? `Film deleted ${when(job.filmDeletedAt)}` : job.filmExpiresAt ? `Film is deleted ${when(job.filmExpiresAt)}` : ""}</span>
        <button type="button" onClick={onDelete} className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 font-semibold hover:text-destructive")}>
          <Trash2 className="size-3.5" aria-hidden="true" />
          Delete game
        </button>
      </div>
    </div>
  );
}

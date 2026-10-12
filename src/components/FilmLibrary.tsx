"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Film, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { filmApi } from "@/lib/film/client";
import type { JobView } from "@/lib/film/jobs";
import { CLIP_RETENTION_DAYS, MAX_CLIP_BYTES, isValidClipName } from "@/lib/film/shared";
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

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function FilmLibrary() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<File[]>([]);
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
  const active = jobs?.some((j) => j.stage === "reading" || j.stage === "building") ?? false;
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => void refresh(), POLL_MS);
    return () => clearTimeout(timer);
  }, [active, jobs, refresh]);

  function pick(list: FileList | null) {
    const all = Array.from(list ?? []);
    const videos = all.filter((f) => VIDEO.test(f.name));
    setSkipped(all.filter((f) => !VIDEO.test(f.name)).map((f) => f.name));
    setPicked(videos);
    setError(null);
    setFailedClips([]);
    setPending(null);
  }

  const badNames = picked.filter((f) => !isValidClipName(f.name)).map((f) => f.name);
  const tooBig = picked.filter((f) => f.size > MAX_CLIP_BYTES).map((f) => f.name);
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
          multipart: item.size > 8 * 1024 * 1024,
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
      const { job, uploads } = await filmApi.create(picked.map((f) => ({ name: f.name, size: f.size })));
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
            Pick one game&apos;s clips, one per play (.mp4, .mov or .m4v, up to {MAX_CLIP_BYTES / 1024 / 1024} MB each). We
            read every play and build the scout cards. The film is deleted {CLIP_RETENTION_DAYS} days after you upload it; the
            cards stay.
          </p>
        </div>

        <input
          ref={input}
          type="file"
          accept="video/mp4,video/quicktime,video/x-m4v,.mp4,.mov,.m4v"
          multiple
          className="sr-only"
          aria-label="Choose a game's clips"
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="lg" disabled={working} onClick={() => input.current?.click()}>
            <Film aria-hidden="true" />
            {picked.length ? "Choose different clips" : "Choose clips"}
          </Button>
          {picked.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {picked.length} {picked.length === 1 ? "clip" : "clips"} · {formatBytes(total)}
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
            Too large (over {MAX_CLIP_BYTES / 1024 / 1024} MB): {tooBig.slice(0, 4).join(", ")}.
          </p>
        )}

        {picked.length > 0 && !pending && (
          <div>
            <Button size="xl" disabled={working || badNames.length > 0 || tooBig.length > 0} onClick={() => void begin()}>
              {working ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
              {busy === "creating" ? "Getting ready…" : busy === "starting" ? "Starting…" : busy === "uploading" ? `Uploading… ${percent}%` : `Upload ${picked.length} ${picked.length === 1 ? "clip" : "clips"}`}
            </Button>
          </div>
        )}

        {busy === "uploading" && progress && (
          <div className="flex flex-col gap-1.5" role="status">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-sm text-muted-foreground">
              {progress.filesDone} of {progress.filesTotal} clips uploaded · keep this tab open until it finishes
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
          <span className="text-sm text-muted-foreground">{job.total} {job.total === 1 ? "clip" : "clips"}</span>
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

/**
 * The real storage (this project's private Vercel Blob store) and the real dispatcher (an HTTP POST to
 * the film worker) behind `service.ts`, plus the small gate every film route starts with.
 *
 * Server only: it reads secrets from the environment.
 *
 *   FILM_WORKER_URL      where the worker listens, e.g. https://worker.example.com (no trailing slash needed)
 *   FILM_WORKER_SECRET   shared with the worker (`FILM_WORKER_SECRET` there); the per-job tokens come from it
 *   FILM_CALLBACK_ORIGIN the app's public address the worker calls back, if the request's own address isn't
 *                        reachable from the worker (a preview behind Vercel's sign-in, say)
 *   CRON_SECRET          Vercel sends it as a bearer token with the daily cleanup
 */

import { BlobError, BlobPreconditionFailedError, del, get, list, put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requireEntitlement } from "../entitlement";
import { isAiGateDisabled } from "../featureFlags";
import type { AccessTier } from "../usageLimits";
import { isValidJobId, isValidTeamKey, verifyWorkerToken } from "./jobs";
import { FilmError, type Dispatcher, type FilmContext, type FilmStorage, type StoredObject } from "./service";

const DELETE_BATCH = 100;

export class BlobFilmStorage implements FilmStorage {
  async getJson<T>(pathname: string): Promise<T | null> {
    const found = await get(pathname, { access: "private", useCache: false });
    if (!found || found.statusCode !== 200) return null;
    return JSON.parse(await new Response(found.stream).text()) as T;
  }

  async putJson(pathname: string, value: unknown, opts?: { exclusive?: boolean }): Promise<boolean> {
    try {
      await put(pathname, JSON.stringify(value), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: !opts?.exclusive,
        contentType: "application/json",
      });
      return true;
    } catch (error) {
      if (opts?.exclusive && (error instanceof BlobPreconditionFailedError || (error instanceof BlobError && /already exists/i.test(error.message)))) {
        return false;
      }
      throw error;
    }
  }

  async putBytes(pathname: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await put(pathname, Buffer.from(bytes), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType });
  }

  async getStream(pathname: string, opts?: { range?: string }) {
    const found = await get(pathname, {
      access: "private",
      useCache: false,
      ...(opts?.range ? { headers: { range: opts.range } } : {}),
    });
    if (!found || found.statusCode !== 200) return null;
    // A ranged answer carries Content-Range (the SDK reports any OK status as 200); the length is the part's.
    return { stream: found.stream, size: found.blob.size, contentRange: found.headers.get("content-range") };
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, limit: 1000, cursor });
      out.push(...page.blobs.map((b) => ({ pathname: b.pathname, size: b.size, uploadedAt: b.uploadedAt })));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }

  async remove(pathnames: string[]): Promise<void> {
    for (let i = 0; i < pathnames.length; i += DELETE_BATCH) await del(pathnames.slice(i, i + DELETE_BATCH));
  }
}

export class HttpDispatcher implements Dispatcher {
  constructor(
    private url = process.env.FILM_WORKER_URL,
    private secret = process.env.FILM_WORKER_SECRET,
  ) {}

  configured(): boolean {
    return Boolean(this.url && this.secret);
  }

  async send(body: Record<string, unknown>): Promise<void> {
    if (!this.url || !this.secret) throw new FilmError(501, "worker_off", "Film processing isn't switched on for this site yet.");
    let response: Response;
    try {
      response = await fetch(`${this.url.replace(/\/+$/, "")}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.secret}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new FilmError(502, "worker_down", "The film analyzer didn't answer. Try again in a few minutes.");
    }
    if (!response.ok) throw new FilmError(502, "worker_refused", `The film analyzer turned the job away (${response.status}).`);
  }
}

export function filmContext(request: Request): FilmContext {
  return {
    storage: new BlobFilmStorage(),
    dispatcher: new HttpDispatcher(),
    secret: process.env.FILM_WORKER_SECRET ?? "",
    origin: (process.env.FILM_CALLBACK_ORIGIN ?? new URL(request.url).origin).replace(/\/+$/, ""),
    now: () => Date.now(),
  };
}

/** What every coach-facing film route starts with: storage set up, signed in and allowed. Never on the open preview. */
export async function filmGate(): Promise<{ owner: string; tier: AccessTier; error?: undefined } | { error: NextResponse; owner?: undefined; tier?: undefined }> {
  if (isAiGateDisabled()) {
    return { error: NextResponse.json({ error: "film_off", message: "Film upload is off here." }, { status: 403 }) };
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { error: NextResponse.json({ error: "film_unavailable", message: "Storage isn't set up." }, { status: 501 }) };
  }
  const access = await requireEntitlement();
  if (!access.ok) {
    return { error: NextResponse.json({ error: access.error, message: access.message }, { status: access.status }) };
  }
  return { owner: access.teamId, tier: access.tier };
}

/** A film error as a JSON answer; anything else is logged and answered plainly. */
export function filmError(error: unknown): NextResponse {
  if (error instanceof FilmError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
  }
  console.error("film route failed", error);
  return NextResponse.json({ error: "film_failed", message: "Something went wrong. Try again." }, { status: 500 });
}

/**
 * What every worker-facing route starts with: the ids are well formed and the request carries this job's own
 * token (see `workerToken`). A worker is not a signed-in coach, so this is its whole authority, scoped to
 * one game.
 */
export function workerGate(request: Request, team: string, id: string): NextResponse | null {
  if (!isValidTeamKey(team) || !isValidJobId(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // The long-video route is read by OpenCV, which can't send a header, so it also takes the token as `?t=`.
  const given = request.headers.get("x-film-token") ?? new URL(request.url).searchParams.get("t");
  if (!verifyWorkerToken(process.env.FILM_WORKER_SECRET, team, id, given)) {
    return NextResponse.json({ error: "bad_token" }, { status: 401 });
  }
  return null;
}

/** The app's functions take about 4.5 MB a request; the worker gzips what it sends. */
export const MAX_WORKER_BODY = 4_400_000;

export async function readWorkerBody(request: Request): Promise<Uint8Array | NextResponse> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_WORKER_BODY) {
    return NextResponse.json({ error: "too_big" }, { status: 413 });
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (bytes.byteLength > MAX_WORKER_BODY) return NextResponse.json({ error: "too_big" }, { status: 413 });
  return bytes;
}

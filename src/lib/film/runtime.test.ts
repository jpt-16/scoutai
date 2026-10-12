import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newJobId, teamKey, workerToken } from "./jobs";
import { HttpDispatcher, MAX_WORKER_BODY, filmContext, filmError, filmGate, readWorkerBody, workerGate } from "./runtime";
import { FilmError } from "./service";

const team = teamKey("org_pilot");
const id = newJobId();

const req = (token: string | null, extra: Record<string, string> = {}) =>
  new Request("https://app.test/api/film/worker/x", { method: "POST", headers: { ...(token ? { "x-film-token": token } : {}), ...extra } });

beforeEach(() => {
  vi.stubEnv("FILM_WORKER_SECRET", "s3cret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("workerGate", () => {
  it("lets in the job's own token and nothing else", async () => {
    expect(workerGate(req(workerToken("s3cret", team, id)), team, id)).toBeNull();
    expect((workerGate(req("wrong"), team, id))?.status).toBe(401);
    expect((workerGate(req(null), team, id))?.status).toBe(401);
    // a token for another game
    expect((workerGate(req(workerToken("s3cret", team, newJobId())), team, id))?.status).toBe(401);
  });

  it("refuses everyone when no secret is configured", () => {
    vi.stubEnv("FILM_WORKER_SECRET", "");
    expect(workerGate(req(workerToken("", team, id)), team, id)?.status).toBe(401);
  });

  it("answers 404 to ids that aren't ours, before looking at the token", () => {
    expect(workerGate(req(workerToken("s3cret", team, id)), "../x", id)?.status).toBe(404);
    expect(workerGate(req(workerToken("s3cret", team, id)), team, "not-an-id")?.status).toBe(404);
  });
});

describe("readWorkerBody", () => {
  it("refuses an empty or oversized body", async () => {
    const big = await readWorkerBody(req("t", { "content-length": String(MAX_WORKER_BODY + 1) }));
    expect(big instanceof Response && big.status).toBe(413);
    const empty = await readWorkerBody(new Request("https://app.test/x", { method: "PUT", body: new Uint8Array(0) }));
    expect(empty instanceof Response && empty.status).toBe(400);
    const ok = await readWorkerBody(new Request("https://app.test/x", { method: "PUT", body: new Uint8Array([1, 2, 3]) }));
    expect(ok instanceof Uint8Array && ok.byteLength).toBe(3);
  });
});

describe("HttpDispatcher", () => {
  it("is only configured with both a url and a secret", () => {
    expect(new HttpDispatcher("https://w.test", "s").configured()).toBe(true);
    expect(new HttpDispatcher("https://w.test", "").configured()).toBe(false);
    expect(new HttpDispatcher(undefined, "s").configured()).toBe(false);
  });

  it("posts the job to /jobs with the bearer secret", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await new HttpDispatcher("https://w.test/", "s3cret").send({ type: "shard", jobId: "j" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://w.test/jobs");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer s3cret");
    expect(JSON.parse(init.body as string)).toEqual({ type: "shard", jobId: "j" });
  });

  it("turns a refusal or a dead worker into a plain error the coach can read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
    await expect(new HttpDispatcher("https://w.test", "s").send({})).rejects.toMatchObject({ status: 502, code: "worker_refused" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(new HttpDispatcher("https://w.test", "s").send({})).rejects.toMatchObject({ status: 502, code: "worker_down" });
    await expect(new HttpDispatcher(undefined, undefined).send({})).rejects.toMatchObject({ status: 501 });
  });
});

describe("filmContext and filmError", () => {
  it("calls the worker back on the request's address unless told otherwise", () => {
    const request = new Request("https://app.test/api/film/jobs/x/start");
    expect(filmContext(request).origin).toBe("https://app.test");
    vi.stubEnv("FILM_CALLBACK_ORIGIN", "https://scoutcard.example/");
    expect(filmContext(request).origin).toBe("https://scoutcard.example");
  });

  it("answers a film error with its own status and reason, and anything else plainly", async () => {
    const known = filmError(new FilmError(409, "x", "Already started."));
    expect(known.status).toBe(409);
    expect(await known.json()).toEqual({ error: "x", message: "Already started." });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(filmError(new Error("secret details")).status).toBe(500);
  });
});

describe("filmGate", () => {
  it("is off where the sign-in gate is bypassed, since that would be one library for anyone holding the URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SKIP_AI_GATE", "true");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");
    const gate = await filmGate();
    expect(gate.error?.status).toBe(403);
  });

  it("says storage isn't set up when there's no Blob token", async () => {
    vi.stubEnv("NEXT_PUBLIC_SKIP_AI_GATE", "");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect((await filmGate()).error?.status).toBe(501);
  });
});

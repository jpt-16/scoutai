import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Loads public/sw.js against a fake worker scope and returns what it registered. */
function loadWorker() {
  const code = readFileSync(join(__dirname, "../../public/sw.js"), "utf8");
  const listeners: Record<string, (event: unknown) => void> = {};
  const put = vi.fn();
  const cache = { put, match: vi.fn().mockResolvedValue(undefined), addAll: vi.fn() };
  const fetchMock = vi.fn().mockResolvedValue(new Response("body", { status: 200 }));
  const scope = {
    location: { origin: "https://app.example" },
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const caches = { open: vi.fn().mockResolvedValue(cache), keys: vi.fn().mockResolvedValue([]), delete: vi.fn() };
  new Function("self", "caches", "fetch", "URL", code)(scope, caches, fetchMock, URL);
  /** Fires a fetch event; returns whether the worker took the request over. */
  async function fire(url: string, init: { method?: string; mode?: string } = {}): Promise<boolean> {
    let handled = false;
    const respondWith = (p: Promise<unknown>) => {
      handled = true;
      void p;
    };
    listeners.fetch({ request: { url, method: init.method ?? "GET", mode: init.mode ?? "cors" }, respondWith });
    await new Promise((r) => setTimeout(r, 0));
    return handled;
  }
  return { fire, put, source: code };
}

describe("the service worker", () => {
  it("never touches /api/: a signed-in answer must not outlive the sign-out in the browser's cache", async () => {
    const sw = loadWorker();
    for (const path of ["/api/sync?slot=script", "/api/film/jobs", "/api/film/jobs/0123456789abcdef01/game", "/api/ai-access"]) {
      expect(await sw.fire(`https://app.example${path}`)).toBe(false);
    }
    expect(sw.put).not.toHaveBeenCalled();
  });

  it("still serves the app offline: pages, build assets and icons", async () => {
    const sw = loadWorker();
    expect(await sw.fire("https://app.example/script", { mode: "navigate" })).toBe(true);
    expect(await sw.fire("https://app.example/_next/static/chunks/app.js")).toBe(true);
    expect(await sw.fire("https://app.example/icons/icon-192.png")).toBe(true);
    expect(await sw.fire("https://app.example/manifest.json")).toBe(true);
  });

  it("leaves other origins and non-GET requests alone", async () => {
    const sw = loadWorker();
    expect(await sw.fire("https://clerk.example/v1/client")).toBe(false);
    expect(await sw.fire("https://app.example/script", { method: "POST" })).toBe(false);
  });

  it("uses a new cache name, so devices that already cached API answers drop them on activate", () => {
    const { source } = loadWorker();
    expect(source).toMatch(/CACHE_VERSION = "scoutcard-v([3-9]|\d{2,})"/);
  });
});

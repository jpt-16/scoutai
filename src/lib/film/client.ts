/**
 * The browser's side of `/api/film/*`: plain fetches that turn an error answer into a readable message.
 */

import type { JobView } from "./jobs";
import type { Upload } from "./service";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error("Couldn't reach ScoutCard AI. Check your connection and try again.");
  }
  const data = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(data.message ?? "Something went wrong. Try again.");
  return data as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const filmApi = {
  async list(): Promise<JobView[]> {
    return (await call<{ jobs: JobView[] }>("/api/film/jobs", { cache: "no-store" })).jobs;
  },
  create(files: { name: string; size: number }[], kind: "clips" | "video" = "clips"): Promise<{ job: JobView; uploads: Upload[] }> {
    return call("/api/film/jobs", json({ files, kind }));
  },
  async start(id: string): Promise<JobView> {
    return (await call<{ job: JobView }>(`/api/film/jobs/${id}/start`, { method: "POST" })).job;
  },
  async remove(id: string): Promise<void> {
    await call(`/api/film/jobs/${id}`, { method: "DELETE" });
  },
  /** The finished game file's text, for `parseScriptFile`. */
  async gameText(id: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`/api/film/jobs/${id}/game`, { cache: "no-store" });
    } catch {
      throw new Error("Couldn't reach ScoutCard AI. Check your connection and try again.");
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(data.message ?? "Couldn't open that game.");
    }
    return response.text();
  },
};

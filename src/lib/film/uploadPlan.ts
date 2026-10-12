/**
 * Uploading a game's clips from the browser: a few at a time, each retried once or twice (a stadium
 * Wi-Fi drops connections), with one overall progress number. The actual byte-moving is passed in
 * (`@vercel/blob/client`'s `upload` in the app, a stub in tests), so the policy is testable alone.
 */

export interface UploadItem {
  index: number;
  name: string;
  pathname: string;
  size: number;
}

export interface UploadProgress {
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
}

export interface UploadOutcome {
  failed: { name: string; message: string }[];
}

export const UPLOADS_AT_ONCE = 3;
export const UPLOAD_RETRIES = 2;

export async function runUploads(
  items: UploadItem[],
  send: (item: UploadItem, onBytes: (loaded: number) => void) => Promise<void>,
  opts: { concurrency?: number; retries?: number; onProgress?: (p: UploadProgress) => void; wait?: (ms: number) => Promise<void> } = {},
): Promise<UploadOutcome> {
  const concurrency = Math.max(1, opts.concurrency ?? UPLOADS_AT_ONCE);
  const retries = opts.retries ?? UPLOAD_RETRIES;
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const loaded = new Map<number, number>();
  let filesDone = 0;
  const failed: UploadOutcome["failed"] = [];
  const bytesTotal = items.reduce((sum, i) => sum + i.size, 0);

  const report = () =>
    opts.onProgress?.({
      filesDone,
      filesTotal: items.length,
      bytesDone: [...loaded.values()].reduce((a, b) => a + b, 0),
      bytesTotal,
    });

  let next = 0;
  async function lane(): Promise<void> {
    for (;;) {
      const item = items[next++];
      if (!item) return;
      let lastError = "";
      let ok = false;
      for (let attempt = 0; attempt <= retries && !ok; attempt++) {
        if (attempt > 0) await wait(1000 * 2 ** (attempt - 1));
        loaded.set(item.index, 0);
        try {
          await send(item, (bytes) => {
            loaded.set(item.index, Math.min(bytes, item.size));
            report();
          });
          ok = true;
        } catch (error) {
          lastError = error instanceof Error ? error.message : "Upload failed.";
        }
      }
      if (ok) {
        loaded.set(item.index, item.size);
        filesDone++;
      } else {
        loaded.set(item.index, 0);
        failed.push({ name: item.name, message: lastError });
      }
      report();
    }
  }

  report();
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  return { failed };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

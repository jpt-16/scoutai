import { describe, expect, it } from "vitest";
import { formatBytes, runUploads, type UploadItem, type UploadProgress } from "./uploadPlan";

const items = (n: number): UploadItem[] =>
  Array.from({ length: n }, (_, i) => ({ index: i, name: `play_${i + 1}.mp4`, pathname: `p/${i}`, size: 1000 }));
const instant = () => Promise.resolve();

describe("runUploads", () => {
  it("never has more than the allowed number going at once, and does them all", async () => {
    let running = 0;
    let worst = 0;
    const done: number[] = [];
    const result = await runUploads(
      items(10),
      async (item) => {
        running++;
        worst = Math.max(worst, running);
        await new Promise((r) => setTimeout(r, 2));
        running--;
        done.push(item.index);
      },
      { concurrency: 3, wait: instant },
    );
    expect(result.failed).toEqual([]);
    expect(worst).toBe(3);
    expect(done.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("retries a clip that drops, and succeeds if a later try works", async () => {
    const tries = new Map<number, number>();
    const result = await runUploads(
      items(3),
      async (item) => {
        const n = (tries.get(item.index) ?? 0) + 1;
        tries.set(item.index, n);
        if (item.index === 1 && n < 3) throw new Error("connection reset");
      },
      { retries: 2, wait: instant },
    );
    expect(result.failed).toEqual([]);
    expect(tries.get(1)).toBe(3);
    expect(tries.get(0)).toBe(1);
  });

  it("reports the clips that never made it, by name, with the reason, and carries on with the rest", async () => {
    const sent: number[] = [];
    const result = await runUploads(
      items(4),
      async (item) => {
        if (item.index === 2) throw new Error("too large");
        sent.push(item.index);
      },
      { retries: 1, wait: instant },
    );
    expect(result.failed).toEqual([{ name: "play_3.mp4", message: "too large" }]);
    expect(sent.sort()).toEqual([0, 1, 3]);
  });

  it("backs off between tries", async () => {
    const waits: number[] = [];
    await runUploads(items(1), async () => { throw new Error("x"); }, { retries: 2, wait: async (ms) => { waits.push(ms); } });
    expect(waits).toEqual([1000, 2000]);
  });

  it("reports whole-game progress in files and bytes, ending complete", async () => {
    const seen: UploadProgress[] = [];
    await runUploads(
      items(2),
      async (item, onBytes) => {
        onBytes(500);
        onBytes(1000 + 99); // a runaway number is clamped to the file's size
        void item;
      },
      { concurrency: 1, wait: instant, onProgress: (p) => seen.push(p) },
    );
    expect(seen[0]).toEqual({ filesDone: 0, filesTotal: 2, bytesDone: 0, bytesTotal: 2000 });
    expect(Math.max(...seen.map((p) => p.bytesDone))).toBe(2000);
    expect(seen.at(-1)).toEqual({ filesDone: 2, filesTotal: 2, bytesDone: 2000, bytesTotal: 2000 });
  });

  it("a clip that retries starts its byte count over instead of double counting", async () => {
    const seen: UploadProgress[] = [];
    let first = true;
    await runUploads(
      items(1),
      async (_item, onBytes) => {
        onBytes(900);
        if (first) {
          first = false;
          throw new Error("dropped");
        }
      },
      { retries: 1, wait: instant, onProgress: (p) => seen.push(p) },
    );
    expect(Math.max(...seen.map((p) => p.bytesDone))).toBeLessThanOrEqual(1000);
    expect(seen.at(-1)?.bytesDone).toBe(1000);
  });

  it("does nothing, quickly, for no clips", async () => {
    expect(await runUploads([], async () => {})).toEqual({ failed: [] });
  });
});

describe("formatBytes", () => {
  it("reads like a person would say it", () => {
    expect(formatBytes(500)).toBe("1 KB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(42 * 1024 * 1024)).toBe("42 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });
});

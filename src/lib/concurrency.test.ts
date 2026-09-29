import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("preserves input order regardless of completion order", async () => {
    const items = [30, 10, 20, 5, 25];
    const results = await mapWithConcurrency(items, 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    expect(results).toEqual(items);
  });

  it("never runs more than `limit` calls at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 9 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async (i) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return i;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1); // actually ran concurrently, not serially
  });

  it("handles an empty array", async () => {
    const results = await mapWithConcurrency([], 4, async (i: number) => i);
    expect(results).toEqual([]);
  });

  it("handles a limit larger than the item count", async () => {
    const results = await mapWithConcurrency([1, 2], 10, async (i) => i * 2);
    expect(results).toEqual([2, 4]);
  });

  it("isolates per-item failures when fn catches its own errors", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (i) => {
      if (i === 2) return { error: "boom" };
      return { value: i };
    });
    expect(results).toEqual([{ value: 1 }, { error: "boom" }, { value: 3 }]);
  });
});

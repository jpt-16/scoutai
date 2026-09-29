/**
 * Runs `fn` over `items` with at most `limit` calls in flight at once,
 * preserving input order in the returned array regardless of completion
 * order. `fn` should catch its own errors and return an error value rather
 * than reject — a rejection here aborts every other in-flight item, which
 * defeats the point of isolating one bad item (see `src/app/api/
 * parse-video-batch/route.ts`, where one clip failing shouldn't sink the
 * rest of the batch).
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

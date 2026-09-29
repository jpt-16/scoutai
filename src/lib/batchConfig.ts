/**
 * Shared between `/api/parse-video-batch/route.ts` (enforces it server-side)
 * and `src/components/BatchUploader.tsx` (chunks a zip's clips to match it
 * client-side) — a plain constant so the client bundle never has to import
 * anything from the route file itself.
 */
export const MAX_BATCH_CLIPS = 10;

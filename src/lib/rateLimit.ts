/**
 * Rate limiting for the video-analysis routes, backed by this project's own
 * private Vercel Blob store. Both gated routes now require an authenticated,
 * entitled team session (see `src/lib/entitlement.ts`) before this even
 * runs, so the identity passed in is the resolved **team id**, not an IP —
 * per-account limiting is what actually matters once every caller is a
 * paying customer, and it avoids a whole coaching staff on one office/
 * stadium Wi-Fi IP tripping a shared limit. This stays as deliberate
 * defense-in-depth against a compromised or over-eager account hammering
 * the endpoint, since Stripe billing itself has no built-in usage cap.
 * `clientIp` is kept for logging.
 *
 * The natural fit here is Vercel's platform-level Firewall rate limiting
 * (`@vercel/firewall`'s `checkRateLimit`, still called alongside this in
 * both routes) — but creating a custom Firewall rule for this project
 * returned a 404 ("Seawall Config not found") on every attempt, including
 * the docs' own minimal example. That matches custom WAF rules being a
 * paid-plan feature Vercel gates with a bare 404 rather than a clear
 * upgrade message, rather than anything wrong with the request. This is
 * the actual enforcement until/unless that becomes available — keep
 * `checkRateLimit` in the routes too so a real Firewall rule (once you're
 * on a plan that supports one) starts working immediately, no code change
 * needed.
 *
 * How it works: each allowed request writes a tiny (empty) marker blob
 * under `ratelimit/<bucket>/<hashed identity>/<window start>/<random>`;
 * checking the limit is `list()`ing that prefix and counting. Not
 * perfectly atomic — two requests from the same team in the same instant
 * could both read the count before either writes its marker — which is
 * fine for this app's actual traffic (a small coaching staff), not a
 * guarantee against a determined, concurrent abuser.
 */

import { list, put } from "@vercel/blob";
import {
  batchMarkerName,
  decideBatchChunk,
  summarizeBatchJobs,
  type BatchDecision,
  type TierLimits,
} from "./usageLimits";

/**
 * Best-effort client IP from the standard proxy header Vercel sets
 * (`x-forwarded-for`, first entry). Falls back to a constant so requests
 * without it still get bucketed together rather than bypassing the limit.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

/** Short, filesystem-safe key for an identity string (e.g. an IP). */
function hashKey(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Records one request and reports whether `identity` is still under
 * `limit` requests within the current `windowMs`-long fixed window for
 * `bucket`. Call once per request, right before doing the expensive work.
 */
export async function checkBlobRateLimit(
  bucket: string,
  identity: string,
  limit: number,
  windowMs: number,
): Promise<{ ok: boolean }> {
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const prefix = `ratelimit/${bucket}/${hashKey(identity)}/${windowStart}/`;

  try {
    const { blobs } = await list({ prefix, limit: limit + 1 });
    if (blobs.length >= limit) return { ok: false };

    // Record this request. The filename doesn't need to mean anything,
    // just be unique within the window.
    await put(`${prefix}${crypto.randomUUID()}`, "", {
      access: "private",
      addRandomSuffix: false,
      contentType: "text/plain",
    });
    return { ok: true };
  } catch (error) {
    // If Blob itself is misconfigured (e.g. BLOB_READ_WRITE_TOKEN missing),
    // fail open rather than take the whole feature down over rate limiting —
    // but log it, since that also means uploads/analysis are about to fail
    // anyway for the same reason.
    console.error(`checkBlobRateLimit(${bucket}) failed, allowing the request`, error);
    return { ok: true };
  }
}

const HOUR = 60 * 60 * 1000;

/**
 * Batch import's job limit (see usageLimits.ts): how many games a staff can
 * have running at once, and how many plays one game may have. Each allowed
 * chunk writes a marker `ratelimit/batch-jobs/<team>/<hour>/<jobId>/<time>-<clips>[-done]`;
 * the check lists this hour's and the last hour's markers (a job is done in
 * well under an hour) and rolls them up per job. Fails open like
 * `checkBlobRateLimit`.
 */
export async function checkBatchJob(
  identity: string,
  job: { jobId: string; clips: number; totalPlays: number; final: boolean },
  limits: TierLimits["batch"],
): Promise<BatchDecision> {
  const now = Date.now();
  const hour = Math.floor(now / HOUR) * HOUR;
  const base = `ratelimit/batch-jobs/${hashKey(identity)}/`;
  try {
    const names: string[] = [];
    for (const h of [hour - HOUR, hour]) {
      const prefix = `${base}${h}/`;
      const { blobs } = await list({ prefix, limit: 1000 });
      names.push(...blobs.map((b) => b.pathname.slice(prefix.length)));
    }
    const decision = decideBatchChunk(summarizeBatchJobs(names), job.jobId, job.clips, job.totalPlays, limits, now);
    if (!decision.ok) return decision;
    await put(`${base}${hour}/${batchMarkerName(job.jobId, now, job.clips, job.final)}`, "", {
      access: "private",
      addRandomSuffix: false,
      contentType: "text/plain",
    });
    return decision;
  } catch (error) {
    console.error("checkBatchJob failed, allowing the chunk", error);
    return { ok: true };
  }
}

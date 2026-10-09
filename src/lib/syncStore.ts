/**
 * Server side of the staff's shared copy: one private Vercel Blob per team per
 * thing (script, playbook, playsheet), at `sync/<hash of the team id>/<slot>`.
 * The blob's own ETag is the version, so a write that was made against an old copy
 * is refused by the store itself (`ifMatch`), not by a read-then-write that two
 * coaches could race through.
 *
 * The body is opaque here: the browser gzips the JSON, and this stores it as sent.
 */

import { createHash } from "node:crypto";
import { BlobError, BlobPreconditionFailedError, get, put } from "@vercel/blob";
import type { SyncSlot } from "./syncMeta";

/** Vercel functions take bodies up to 4.5 MB; stay under it. */
export const MAX_SYNC_BYTES = 4_000_000;

export function slotPath(owner: string, slot: SyncSlot): string {
  const key = createHash("sha256").update(owner).digest("hex").slice(0, 24);
  return `sync/${key}/${slot}`;
}

export type ReadResult =
  | { kind: "none" }
  | { kind: "unchanged" }
  | { kind: "data"; etag: string; updatedAt: string; contentType: string; body: Uint8Array };

export async function readSlot(owner: string, slot: SyncSlot, ifNoneMatch?: string | null): Promise<ReadResult> {
  const found = await get(slotPath(owner, slot), {
    access: "private",
    useCache: false,
    ...(ifNoneMatch ? { ifNoneMatch } : {}),
  });
  if (!found) return { kind: "none" };
  if (found.statusCode === 304) return { kind: "unchanged" };
  return {
    kind: "data",
    etag: found.blob.etag,
    updatedAt: found.blob.uploadedAt.toISOString(),
    contentType: found.blob.contentType,
    body: new Uint8Array(await new Response(found.stream).arrayBuffer()),
  };
}

export type WriteResult = { kind: "ok"; etag: string } | { kind: "conflict" };

/**
 * Writes the slot if it still matches `baseEtag` (the copy the writer last saw), or
 * if it doesn't exist yet and `baseEtag` is null. Anything else is a conflict.
 */
export async function writeSlot(
  owner: string,
  slot: SyncSlot,
  body: Uint8Array,
  contentType: string,
  baseEtag: string | null,
): Promise<WriteResult> {
  try {
    const result = await put(slotPath(owner, slot), Buffer.from(body), {
      access: "private",
      addRandomSuffix: false,
      contentType,
      // First write: refuse if someone else made it first. Later: only over the copy we saw.
      allowOverwrite: baseEtag != null,
      ...(baseEtag ? { ifMatch: baseEtag } : {}),
    });
    return { kind: "ok", etag: result.etag };
  } catch (error) {
    if (error instanceof BlobPreconditionFailedError) return { kind: "conflict" };
    if (error instanceof BlobError && /already exists/i.test(error.message)) return { kind: "conflict" };
    throw error;
  }
}

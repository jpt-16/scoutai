import { beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => {
  class BlobError extends Error {}
  class BlobPreconditionFailedError extends BlobError {}
  return { BlobError, BlobPreconditionFailedError, get: vi.fn(), put: vi.fn() };
});
vi.mock("@vercel/blob", () => blob);

import { readSlot, slotPath, writeSlot } from "./syncStore";

beforeEach(() => {
  blob.get.mockReset();
  blob.put.mockReset();
});

describe("slotPath", () => {
  it("is private to the team and never carries the team id itself", () => {
    const a = slotPath("org_abc123", "script");
    expect(a).toMatch(/^sync\/[0-9a-f]{24}\/script$/);
    expect(a).not.toContain("org_abc123");
    expect(slotPath("org_abc123", "script")).toBe(a);
    expect(slotPath("org_other", "script")).not.toBe(a);
    expect(slotPath("org_abc123", "playbook")).not.toBe(a);
  });
});

describe("readSlot", () => {
  it("reports nothing saved, unchanged, or the data with its version", async () => {
    blob.get.mockResolvedValueOnce(null);
    expect(await readSlot("t", "script")).toEqual({ kind: "none" });

    blob.get.mockResolvedValueOnce({ statusCode: 304, stream: null });
    expect(await readSlot("t", "script", "e1")).toEqual({ kind: "unchanged" });
    expect(blob.get).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ ifNoneMatch: "e1", access: "private" }));

    blob.get.mockResolvedValueOnce({
      statusCode: 200,
      stream: new Response("hello").body,
      blob: { etag: "e2", uploadedAt: new Date("2026-10-09T12:00:00Z"), contentType: "application/gzip" },
    });
    const found = await readSlot("t", "script");
    expect(found).toMatchObject({ kind: "data", etag: "e2", contentType: "application/gzip", updatedAt: "2026-10-09T12:00:00.000Z" });
    expect(found.kind === "data" && new TextDecoder().decode(found.body)).toBe("hello");
  });
});

describe("writeSlot", () => {
  const body = new Uint8Array([1, 2, 3]);

  it("writes over the copy it saw, and only that one", async () => {
    blob.put.mockResolvedValueOnce({ etag: "e3" });
    expect(await writeSlot("t", "script", body, "application/gzip", "e2")).toEqual({ kind: "ok", etag: "e3" });
    expect(blob.put).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ access: "private", allowOverwrite: true, ifMatch: "e2", addRandomSuffix: false }),
    );
  });

  it("is a conflict when the copy moved since", async () => {
    blob.put.mockRejectedValueOnce(new blob.BlobPreconditionFailedError("etag mismatch"));
    expect(await writeSlot("t", "script", body, "application/gzip", "e2")).toEqual({ kind: "conflict" });
  });

  it("the first write refuses to overwrite someone else's first write", async () => {
    blob.put.mockRejectedValueOnce(new blob.BlobError("This blob already exists"));
    expect(await writeSlot("t", "script", body, "application/gzip", null)).toEqual({ kind: "conflict" });
    expect(blob.put).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ allowOverwrite: false }),
    );
    const options = blob.put.mock.calls.at(-1)![2];
    expect(options.ifMatch).toBeUndefined();
  });

  it("lets a real failure through", async () => {
    blob.put.mockRejectedValueOnce(new Error("network"));
    await expect(writeSlot("t", "script", body, "application/gzip", "e2")).rejects.toThrow("network");
  });
});

import { describe, expect, it } from "vitest";
import { isBareFileName } from "./blobPaths";

describe("isBareFileName", () => {
  it("takes the plain names a phone or laptop gives a clip", () => {
    for (const name of ["clip.mp4", "IMG_0042.MOV", "pre snap (2).mp4", "play 5.m4v"]) expect(isBareFileName(name)).toBe(true);
  });

  it("refuses a path into one of the app's own folders", () => {
    for (const name of [
      "sync/0123456789abcdef01234567/script",
      "film/0123456789abcdef01234567/0123456789abcdef01/status/0-done.json",
      "filmjobs/x/y.json",
      "ratelimit/blob-upload-paid/abc/123/x.mp4",
      "../x.mp4",
      "a\\b.mp4",
      "/clip.mp4",
    ]) {
      expect(isBareFileName(name)).toBe(false);
    }
  });

  it("refuses nothing, non-text and absurdly long names", () => {
    expect(isBareFileName("")).toBe(false);
    expect(isBareFileName(undefined)).toBe(false);
    expect(isBareFileName(42)).toBe(false);
    expect(isBareFileName("a".repeat(201))).toBe(false);
    expect(isBareFileName("a".repeat(200))).toBe(true);
  });
});

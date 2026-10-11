import { afterEach, describe, expect, it, vi } from "vitest";
import { isFilmImportEnabled } from "./featureFlags";

describe("isFilmImportEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is on unless NEXT_PUBLIC_FILM_IMPORT is exactly false", () => {
    expect(isFilmImportEnabled()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_FILM_IMPORT", "true");
    expect(isFilmImportEnabled()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_FILM_IMPORT", "false");
    expect(isFilmImportEnabled()).toBe(false);
  });
});

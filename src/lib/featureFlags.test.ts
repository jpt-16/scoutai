import { afterEach, describe, expect, it, vi } from "vitest";
import { isFilmImportEnabled } from "./featureFlags";

describe("isFilmImportEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off unless NEXT_PUBLIC_FILM_IMPORT is exactly true", () => {
    expect(isFilmImportEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_FILM_IMPORT", "1");
    expect(isFilmImportEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_FILM_IMPORT", "true");
    expect(isFilmImportEnabled()).toBe(true);
  });
});

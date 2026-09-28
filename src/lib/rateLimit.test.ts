import { describe, expect, it } from "vitest";
import { clientIp } from "./rateLimit";

// checkBlobRateLimit itself needs a live Vercel Blob store (BLOB_READ_WRITE_TOKEN)
// to test for real, same as parse-video's Gemini call — not exercised here.
describe("clientIp", () => {
  it("reads the first address out of x-forwarded-for", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.4, 70.41.3.18" },
    });
    expect(clientIp(request)).toBe("203.0.113.4");
  });

  it("falls back to a constant when the header is missing", () => {
    const request = new Request("https://example.com");
    expect(clientIp(request)).toBe("unknown");
  });
});

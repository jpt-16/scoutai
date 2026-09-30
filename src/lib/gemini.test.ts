import { describe, expect, it } from "vitest";
import { classifyGeminiError, geminiModels, geminiReason, generateJson, type GeminiClient } from "./gemini";

const apiError = (code: number, status: string, message: string) =>
  new Error(JSON.stringify({ error: { code, message, status } }));

/** A fake client: `answer(model, config)` returns text or throws. */
function fake(answer: (model: string, config: Record<string, unknown>) => string) {
  const calls: { model: string; schema: boolean; thinking: boolean }[] = [];
  const ai: GeminiClient = {
    models: {
      generateContent: async ({ model, config = {} }) => {
        const c = config as Record<string, unknown>;
        calls.push({ model, schema: Boolean(c.responseSchema), thinking: Boolean(c.thinkingConfig) });
        return { text: answer(model, c) };
      },
    },
  };
  return { ai, calls };
}

const run = (ai: GeminiClient, fast = false) =>
  generateJson(ai, { contents: "hi", schema: { type: "OBJECT" } as never, fast, models: ["gemini-flash-latest", "gemini-2.5-flash"] });

describe("generateJson", () => {
  it("moves on to the next model when one has been retired", async () => {
    const { ai, calls } = fake((model) => {
      if (model === "gemini-flash-latest") throw apiError(404, "NOT_FOUND", "models/gemini-flash-latest is not found for API version v1beta");
      return '{"ok":true}';
    });
    expect(await run(ai)).toEqual({ ok: true, text: '{"ok":true}', model: "gemini-2.5-flash" });
    expect(calls.map((c) => c.model)).toEqual(["gemini-flash-latest", "gemini-2.5-flash"]);
  });

  it("drops the thinking setting, then the schema, when a model refuses them", async () => {
    const { ai, calls } = fake((_, config) => {
      if (config.responseSchema) throw apiError(400, "INVALID_ARGUMENT", "The specified schema produces a constraint that has too many states");
      return "{}";
    });
    expect((await run(ai, true)).ok).toBe(true);
    expect(calls).toEqual([
      { model: "gemini-flash-latest", schema: true, thinking: true },
      { model: "gemini-flash-latest", schema: true, thinking: false },
      { model: "gemini-flash-latest", schema: false, thinking: false },
    ]);
  });

  it("stops at once on a bad key or used-up quota, with Gemini's own reason", async () => {
    const { ai, calls } = fake(() => {
      throw apiError(429, "RESOURCE_EXHAUSTED", "You exceeded your current quota");
    });
    expect(await run(ai)).toEqual({ ok: false, error: "RESOURCE_EXHAUSTED: You exceeded your current quota" });
    expect(calls).toHaveLength(1);
    expect(classifyGeminiError("INVALID_ARGUMENT: API key not valid. Please pass a valid API key.")).toBe("stop");
  });

  it("reports the last reason when no model answers", async () => {
    const { ai } = fake(() => {
      throw apiError(404, "NOT_FOUND", "models/x is not found");
    });
    expect(await run(ai)).toEqual({ ok: false, error: "NOT_FOUND: models/x is not found" });
  });
});

describe("geminiModels / geminiReason", () => {
  it("tries the GEMINI_MODEL override first, never twice", () => {
    expect(geminiModels("gemini-3-flash")).toEqual(["gemini-3-flash", "gemini-flash-latest", "gemini-2.5-flash"]);
    expect(geminiModels("gemini-2.5-flash")).toEqual(["gemini-2.5-flash", "gemini-flash-latest"]);
    expect(geminiModels("")).toEqual(["gemini-flash-latest", "gemini-2.5-flash"]);
  });

  it("keeps a plain error message short", () => {
    expect(geminiReason(new Error("fetch failed"))).toBe("fetch failed");
  });
});

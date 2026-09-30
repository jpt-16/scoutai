/**
 * The one way the app asks Gemini for JSON, shared by every AI route (text
 * cards, import review, clip routes, the secondary read).
 *
 * - **Model**: `GEMINI_MODEL` (a Vercel env var, so a retired model is a
 *   settings change, not a code change), then `gemini-flash-latest` (Google's
 *   alias for the current Flash), then `gemini-2.5-flash`. A model Google no
 *   longer serves (404 / NOT_FOUND) moves on to the next one: every AI
 *   feature used to be pinned to `gemini-2.5-flash`, so one retirement broke
 *   all of them at once.
 * - **Variants per model**: with the response schema (and, for `fast` calls,
 *   thinking turned down), then without the thinking setting, then plain JSON
 *   with no schema. A 400 (a schema or setting that model won't take) tries
 *   the next variant; the caller validates the answer either way.
 * - **Errors** come back as Gemini's own reason ("RESOURCE_EXHAUSTED: quota
 *   exceeded…"), short and one line, for the coach's notice and the logs.
 *
 * Framework-free: the `ai` client is passed in, so tests use a fake.
 */

import type { GenerateContentConfig, GenerateContentParameters } from "@google/genai";

export const DEFAULT_MODELS = ["gemini-flash-latest", "gemini-2.5-flash"] as const;

/** The models to try, in order: the env override first, never twice. */
export function geminiModels(override = process.env.GEMINI_MODEL): string[] {
  return [...new Set([override?.trim(), ...DEFAULT_MODELS].filter((m): m is string => Boolean(m)))];
}

/** The slice of `@google/genai`'s client this needs. */
export interface GeminiClient {
  models: {
    generateContent(params: GenerateContentParameters): Promise<{ text?: string }>;
  };
}

export type GeminiAnswer = { ok: true; text: string; model: string } | { ok: false; error: string };

/** Gemini's own reason, short and one line ("NOT_FOUND: models/x is not found"). */
export function geminiReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const status =
    text.match(/"status":\s*"([A-Z_]+)"/)?.[1] ?? text.match(/\b(400|401|403|404|429|500|503)\b/)?.[1];
  const message = text.match(/"message":\s*"([^"]{1,200})/)?.[1] ?? text.slice(0, 200);
  return [status, message]
    .filter(Boolean)
    .join(": ")
    .replace(/\s+/g, " ")
    .trim();
}

type Kind = "model-gone" | "bad-request" | "stop";

/** What to do after a failure: next model, next variant, or give up (key, quota, outage). */
export function classifyGeminiError(reason: string): Kind {
  if (/NOT_FOUND|\b404\b|is not found|not supported for generateContent|no longer available|deprecated/i.test(reason)) {
    return "model-gone";
  }
  if (/INVALID_ARGUMENT|\b400\b/.test(reason) && !/API key/i.test(reason)) return "bad-request";
  return "stop";
}

export async function generateJson(
  ai: GeminiClient,
  {
    contents,
    schema,
    fast = false,
    models = geminiModels(),
    label = "gemini",
  }: {
    contents: GenerateContentParameters["contents"];
    schema?: GenerateContentConfig["responseSchema"];
    /** Lookup work (the import review): thinking turned down so a full game finishes in time. */
    fast?: boolean;
    models?: string[];
    label?: string;
  },
): Promise<GeminiAnswer> {
  let last = "no model answered";
  for (const model of models) {
    const variants: GenerateContentConfig[] = [];
    const base: GenerateContentConfig = { responseMimeType: "application/json" };
    if (schema && fast) variants.push({ ...base, responseSchema: schema, thinkingConfig: { thinkingBudget: 0 } });
    if (schema) variants.push({ ...base, responseSchema: schema });
    if (!schema && fast) variants.push({ ...base, thinkingConfig: { thinkingBudget: 0 } });
    variants.push(base);
    for (const config of variants) {
      try {
        const result = await ai.models.generateContent({ model, contents, config });
        const text = result.text ?? "";
        if (!text.trim()) {
          last = "the AI returned an empty answer";
          continue;
        }
        return { ok: true, text, model };
      } catch (error) {
        last = geminiReason(error);
        console.error(`${label}: ${model} failed (${last})`);
        const kind = classifyGeminiError(last);
        if (kind === "stop") return { ok: false, error: last };
        if (kind === "model-gone") break; // next model
        // bad-request: next variant
      }
    }
  }
  return { ok: false, error: last };
}

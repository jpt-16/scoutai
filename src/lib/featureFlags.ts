/**
 * Testing-only bypass for the AI video feature's Clerk sign-in + team +
 * subscription gate (src/lib/entitlement.ts, src/components/VideoUploadCard.tsx),
 * so the upload → Gemini → card pipeline itself can be tried out before
 * Clerk/Stripe are fully wired up and trusted.
 *
 * Set `NEXT_PUBLIC_SKIP_AI_GATE=true` in `.env.local` ONLY. Never set it in a
 * real deployment's env vars — and even if it leaks in, the `VERCEL_ENV`
 * check below makes it a no-op on Vercel's production environment, so it can
 * never turn off billing/auth for the actual live site. Remove the env var
 * once you're confident the feature works and are ready for real sign-in.
 */
export function isAiGateDisabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_SKIP_AI_GATE === "true" && process.env.NEXT_PUBLIC_VERCEL_ENV !== "production"
  );
}

/**
 * The AI film-to-card features: the single-clip uploader, the one-click game
 * import (a Hudl zip of clips), and their routes (`/api/parse-video`,
 * `/api/parse-video-batch`). Off by default: a Hudl Assist breakdown is already
 * tagged from the film, so the sheet draws the cards and the film AI is hidden.
 * Set `NEXT_PUBLIC_FILM_IMPORT=true` (inlined at build, so the page and the
 * routes agree) to bring them back. The secondary read from a pre-snap clip
 * (`/api/read-secondary`) is separate and stays on.
 */
export function isFilmImportEnabled(): boolean {
  return process.env.NEXT_PUBLIC_FILM_IMPORT === "true";
}

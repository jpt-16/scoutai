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

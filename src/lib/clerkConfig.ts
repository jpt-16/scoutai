/**
 * True once Clerk's publishable key is set. Everything Clerk-related — the
 * `<ClerkProvider>` wrapper, `clerkMiddleware()`, and every component that
 * calls a Clerk hook — must check this first and render/no-op safely when
 * it's false, so the free CSV path keeps working before the paid video
 * feature is configured. `NEXT_PUBLIC_`-prefixed, so this works in both
 * server and client code (Next.js inlines it into the client bundle).
 */
export function isClerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

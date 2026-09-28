import { describe, expect, it } from "vitest";
import { evaluateEntitlement } from "./entitlement";

describe("evaluateEntitlement", () => {
  it("requires sign-in when there's no user", () => {
    const result = evaluateEntitlement({ userId: null, team: null });
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "sign_in_required",
      message: "Sign in to upload film.",
    });
  });

  it("requires a team once signed in", () => {
    const result = evaluateEntitlement({ userId: "user-1", team: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it.each([null, "past_due", "canceled", "unpaid", "incomplete_expired"])(
    "blocks a team with subscription status %s",
    (subscriptionStatus) => {
      const result = evaluateEntitlement({
        userId: "user-1",
        team: { id: "team-1", subscriptionStatus },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(402);
    },
  );

  it.each(["active", "trialing"])("allows a team with subscription status %s", (subscriptionStatus) => {
    const result = evaluateEntitlement({
      userId: "user-1",
      team: { id: "team-1", subscriptionStatus },
    });
    expect(result).toEqual({ ok: true, userId: "user-1", teamId: "team-1" });
  });
});

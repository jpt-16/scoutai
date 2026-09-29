import { describe, expect, it } from "vitest";
import { evaluateEntitlement, isAllowListed } from "./entitlement";

describe("evaluateEntitlement", () => {
  it("requires sign-in when there's no user", () => {
    const result = evaluateEntitlement({ userId: null, team: null });
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "sign_in_required",
      message: "Sign in to use the AI features.",
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
    expect(result).toEqual({ ok: true, userId: "user-1", teamId: "team-1", tier: "paid" });
  });
});

describe("isAllowListed", () => {
  it("matches a verified email against the comma-separated list, ignoring case and spaces", () => {
    expect(isAllowListed(["Coach@School.org"], "a@b.com, coach@school.org")).toBe(true);
    expect(isAllowListed(["someone@else.com"], "a@b.com,coach@school.org")).toBe(false);
  });

  it("allows nobody when the list is empty or unset", () => {
    expect(isAllowListed(["coach@school.org"], undefined)).toBe(false);
    expect(isAllowListed(["coach@school.org"], " , ")).toBe(false);
    expect(isAllowListed([], "coach@school.org")).toBe(false);
  });
});

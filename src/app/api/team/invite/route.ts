/**
 * Mints an invite link for the caller's team (owner only — enforced by the
 * `team_invites` RLS insert policy, not just this route). The invite is
 * shared by the owner however their staff already communicates (text,
 * Slack, ...) rather than this app sending its own email.
 */

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "sign_in_required", message: "Sign in first." }, { status: 401 });
  }

  let body: { teamId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }

  const token = randomBytes(24).toString("base64url");

  const { error } = await supabase
    .from("team_invites")
    .insert({ team_id: body.teamId, token, created_by: user.id });

  if (error) {
    // RLS denies this insert for a non-owner, which lands here as a generic error.
    console.error("team-invite: insert failed", error);
    return NextResponse.json({ error: "Could not create invite (are you the team owner?)" }, { status: 403 });
  }

  const origin = new URL(request.url).origin;
  return NextResponse.json({ url: `${origin}/invite/${token}` });
}

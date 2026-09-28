/**
 * Creates a team and makes the caller its owner. Thin wrapper around the
 * `create_team` Postgres RPC (see supabase/migrations), which does the
 * team-insert + owner-membership-insert atomically.
 */

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

  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Team name is required" }, { status: 400 });
  }

  const { data: teamId, error } = await supabase.rpc("create_team", { name });
  if (error) {
    console.error("team-create: rpc failed", error);
    return NextResponse.json({ error: "Could not create team" }, { status: 500 });
  }

  return NextResponse.json({ teamId });
}

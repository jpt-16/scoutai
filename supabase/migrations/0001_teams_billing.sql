-- Teams, memberships, invites, and Stripe billing state for the paid video-analysis
-- feature. The rest of the app (CSV import, localStorage script storage) has no
-- account concept and never touches these tables.

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Denormalized Stripe state. A team has exactly one subscription at a time,
  -- so this lives directly on teams rather than a separate subscriptions table.
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  subscription_status text,
  subscription_current_period_end timestamptz,
  subscription_price_id text
);

create table if not exists team_members (
  team_id uuid not null references teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  token text not null unique,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Idempotency ledger for Stripe webhook deliveries (Stripe retries on non-2xx,
-- and can send the same event more than once even on success).
create table if not exists stripe_events (
  id text primary key,
  type text not null,
  created_at timestamptz not null default now()
);

alter table teams enable row level security;
alter table team_members enable row level security;
alter table team_invites enable row level security;
alter table stripe_events enable row level security;

-- SECURITY DEFINER helper so membership policies don't recurse on themselves
-- (a team_members policy that queries team_members to authorize team_members).
create or replace function is_team_member(target_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from team_members
    where team_id = target_team_id and user_id = auth.uid()
  );
$$;

create or replace function is_team_owner(target_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from team_members
    where team_id = target_team_id and user_id = auth.uid() and role = 'owner'
  );
$$;

-- teams: members can read their own team. No client-side UPDATE/DELETE policy —
-- subscription fields are written by the Stripe webhook via the service-role
-- key, which bypasses RLS entirely. Creation goes through create_team() below.
create policy "teams: members can select" on teams
  for select using (is_team_member(id));

-- team_members: members can see their own team's roster. INSERT is allowed for
-- a user adding themselves (invite redemption, via redeem_invite()) or an owner
-- adding someone directly. DELETE by an owner, or a member removing themselves.
create policy "team_members: members can select" on team_members
  for select using (is_team_member(team_id));

create policy "team_members: self or owner can insert" on team_members
  for insert with check (user_id = auth.uid() or is_team_owner(team_id));

create policy "team_members: owner or self can delete" on team_members
  for delete using (is_team_owner(team_id) or user_id = auth.uid());

-- team_invites: only owners can create or read invites for their team.
-- Redemption goes through redeem_invite() (security definer), not a raw select.
create policy "team_invites: owners can select" on team_invites
  for select using (is_team_owner(team_id));

create policy "team_invites: owners can insert" on team_invites
  for insert with check (is_team_owner(team_id));

-- stripe_events: no policies — only the service-role client (the webhook route)
-- ever touches this table.

-- Creates a team and makes the calling user its owner, atomically.
create or replace function create_team(name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_team_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into teams (name, created_by) values (name, auth.uid())
  returning id into new_team_id;

  insert into team_members (team_id, user_id, role)
  values (new_team_id, auth.uid(), 'owner');

  return new_team_id;
end;
$$;

-- Validates and redeems an invite token for the calling user.
create or replace function redeem_invite(token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite team_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into invite from team_invites where team_invites.token = redeem_invite.token;

  if invite.id is null then
    raise exception 'invite not found';
  end if;
  if invite.used_at is not null then
    raise exception 'invite already used';
  end if;
  if invite.expires_at < now() then
    raise exception 'invite expired';
  end if;

  insert into team_members (team_id, user_id, role)
  values (invite.team_id, auth.uid(), invite.role)
  on conflict (team_id, user_id) do nothing;

  update team_invites
  set used_at = now(), used_by = auth.uid()
  where id = invite.id;

  return invite.team_id;
end;
$$;

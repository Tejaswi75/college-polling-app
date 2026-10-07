-- College Polling App: database schema for Supabase (PostgreSQL)
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- ---------------------------------------------------------------------------
-- Profiles: one row per signed-up user, with their role
-- ---------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  role       text not null default 'voter' check (role in ('voter', 'admin')),
  created_at timestamptz not null default now()
);

-- Create a profile automatically whenever someone signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- True when the signed-in user is an admin
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------------------------------------------------------------------------
-- Polls, candidates and votes
-- ---------------------------------------------------------------------------
create table public.polls (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 3 and 120),
  description text not null default '',
  is_open     boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table public.candidates (
  id         uuid primary key default gen_random_uuid(),
  poll_id    uuid not null references public.polls (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  manifesto  text not null default '',
  created_at timestamptz not null default now(),
  unique (poll_id, name),   -- no duplicate candidate names in a poll
  unique (id, poll_id)      -- lets votes check that the candidate belongs to the poll
);

create table public.votes (
  id           uuid primary key default gen_random_uuid(),
  poll_id      uuid not null references public.polls (id) on delete cascade,
  candidate_id uuid not null,
  voter_id     uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  -- The database itself makes a second vote in the same poll impossible
  constraint one_vote_per_poll unique (poll_id, voter_id),
  -- A vote can only be for a candidate of the same poll
  constraint candidate_in_poll foreign key (candidate_id, poll_id)
    references public.candidates (id, poll_id) on delete cascade
);

create index votes_candidate_idx on public.votes (candidate_id);

-- ---------------------------------------------------------------------------
-- Row-level security: rules enforced by the database for every request
-- ---------------------------------------------------------------------------
alter table public.profiles   enable row level security;
alter table public.polls      enable row level security;
alter table public.candidates enable row level security;
alter table public.votes      enable row level security;

-- Profiles: see your own; admins see everyone. Nobody can change their own role.
create policy "own profile or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

-- Polls and candidates: every signed-in user can read; only admins can change
create policy "read polls" on public.polls
  for select to authenticated using (true);
create policy "admins manage polls" on public.polls
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "read candidates" on public.candidates
  for select to authenticated using (true);
create policy "admins manage candidates" on public.candidates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Votes: you see only your own (admins see all); you can only vote as yourself,
-- only while the poll is open, and votes can never be edited or deleted.
create policy "see own votes or admin" on public.votes
  for select to authenticated using (voter_id = auth.uid() or public.is_admin());
create policy "vote as yourself in an open poll" on public.votes
  for insert to authenticated
  with check (
    voter_id = auth.uid()
    and exists (select 1 from public.polls p where p.id = poll_id and p.is_open)
  );

-- ---------------------------------------------------------------------------
-- Results: vote counts per candidate. Voters see them once the poll is closed;
-- admins can see them at any time.
-- ---------------------------------------------------------------------------
create or replace function public.poll_results(p_poll uuid)
returns table (candidate_id uuid, name text, votes bigint)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name, count(v.id) as votes
  from public.candidates c
  left join public.votes v on v.candidate_id = c.id
  where c.poll_id = p_poll
    and (public.is_admin() or not (select p.is_open from public.polls p where p.id = p_poll))
  group by c.id, c.name
  order by votes desc, c.name;
$$;

-- Dashboard numbers for admins
create or replace function public.admin_stats()
returns table (polls bigint, open_polls bigint, voters bigint, votes bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.polls),
    (select count(*) from public.polls where is_open),
    (select count(*) from public.profiles where role = 'voter'),
    (select count(*) from public.votes)
  where public.is_admin();
$$;

-- ---------------------------------------------------------------------------
-- After signing up yourself, make your account an admin (replace the email):
--   update public.profiles set role = 'admin' where email = 'you@example.com';
-- ---------------------------------------------------------------------------

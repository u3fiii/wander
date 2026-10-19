-- Wander's shared leaderboard. Run this once in your Supabase project (SQL Editor → New query → Run).
--
-- One row per device. Each device can read the board and submit a new personal best; the game upserts its row.
-- The checks below are a first line against nonsense: tidy names, positive scores, and a score that is plausible
-- for how long the run lasted and how far it went (generous, so real runs are never refused).

create table if not exists public.scores (
  id bigint generated always as identity primary key,
  device_id text not null unique,
  name text not null check (char_length(name) between 1 and 16),
  score integer not null check (score > 0 and score <= 500000),
  distance integer not null default 0 check (distance between 0 and 500000),
  seconds integer not null default 0 check (seconds between 0 and 36000),
  created_at timestamptz not null default now(),
  constraint plausible_score check (score <= 150 * greatest(seconds, 1) + distance + 1000)
);

-- Upgrade an existing leaderboard: old runs have no device identity, so preserve them as legacy rows.
alter table public.scores add column if not exists device_id text;
update public.scores set device_id = 'legacy-' || id::text where device_id is null;
alter table public.scores alter column device_id set not null;
create unique index if not exists scores_device_id_key on public.scores (device_id);

-- A late request from another tab/device session must not replace a newer personal best with a lower score.
create or replace function public.keep_device_personal_best() returns trigger
language plpgsql as $$
begin
  if new.score <= old.score then
    return old;
  end if;
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists scores_keep_personal_best on public.scores;
create trigger scores_keep_personal_best
before update on public.scores
for each row execute function public.keep_device_personal_best();

create index if not exists scores_best on public.scores (score desc, created_at asc);

alter table public.scores enable row level security;

drop policy if exists "Anyone can read the board" on public.scores;
create policy "Anyone can read the board" on public.scores for select to anon using (true);

drop policy if exists "Anyone can add a run" on public.scores;
drop policy if exists "Anyone can update a device record" on public.scores;
drop policy if exists "Anyone can add a device record" on public.scores;
create policy "Anyone can add a device record" on public.scores for insert to anon with check (true);
create policy "Anyone can update a device record" on public.scores for update to anon using (true) with check (true);

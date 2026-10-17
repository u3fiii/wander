-- Wander's shared leaderboard. Run this once in your Supabase project (SQL Editor → New query → Run).
--
-- One row per saved run. Anyone can read the board and add a run; nobody can change or delete rows from the game.
-- The checks below are a first line against nonsense: tidy names, positive scores, and a score that is plausible
-- for how long the run lasted and how far it went (generous, so real runs are never refused).

create table if not exists public.scores (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 16),
  score integer not null check (score > 0 and score <= 500000),
  distance integer not null default 0 check (distance between 0 and 500000),
  seconds integer not null default 0 check (seconds between 0 and 36000),
  created_at timestamptz not null default now(),
  constraint plausible_score check (score <= 150 * greatest(seconds, 1) + distance + 1000)
);

create index if not exists scores_best on public.scores (score desc, created_at asc);

alter table public.scores enable row level security;

drop policy if exists "Anyone can read the board" on public.scores;
create policy "Anyone can read the board" on public.scores for select to anon using (true);

drop policy if exists "Anyone can add a run" on public.scores;
create policy "Anyone can add a run" on public.scores for insert to anon with check (true);

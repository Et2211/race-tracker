-- Race Tracker: the published session calendar, so new sessions are downloaded automatically
-- soon after they become final, before anyone opens them.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Race, sprint, qualifying and sprint-qualifying sessions from OpenF1's schedule. Refreshed daily
-- by the app (/api/cron/calendar), which also picks up reschedules and cancellations.
create table public.session_calendar (
  session_key integer primary key,
  year smallint not null,
  meeting_key integer not null,
  meeting_name text not null,
  circuit text not null,
  session_name text not null,
  date_start timestamptz not null,
  date_end timestamptz not null,
  is_cancelled boolean not null default false,
  download_attempts smallint not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create index session_calendar_end_idx on public.session_calendar (date_end);

comment on table public.session_calendar is 'Published session schedule; drives automatic downloads of new sessions.';

-- Sessions that are final, not yet fully stored, and not given up on. OpenF1 keeps adding results
-- and pit data for a few hours after a session ends, so a session is ready 3 hours after its
-- scheduled end. A failed attempt is retried after 30 minutes, at most 8 times. Sessions that
-- became ready more than 14 days ago are left to on-demand downloads.
create function public.due_sessions()
returns setof public.session_calendar
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
    from public.session_calendar c
    left join public.stored_sessions s on s.session_key = c.session_key
   where not c.is_cancelled
     and c.date_end + interval '3 hours' <= now()
     and c.date_end + interval '3 hours' > now() - interval '14 days'
     and (s.session_key is null or s.windows_stored < s.windows)
     and c.download_attempts < 8
     and (c.last_attempt_at is null or c.last_attempt_at < now() - interval '30 minutes')
   order by c.date_end;
$$;

alter table public.session_calendar enable row level security;
revoke all on public.session_calendar from anon, authenticated;
revoke execute on function public.due_sessions() from public, anon, authenticated;

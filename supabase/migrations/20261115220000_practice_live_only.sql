-- Practice sessions are followed live but never stored (owner's decision: not worth the space).
--  - session_calendar.live_only marks them: relays still start for them (live_session_now()),
--    but due_sessions() never offers them for download.
--  - live_clear_finished() removes live data that is no longer needed: sessions downloaded in
--    full, and live-only sessions that ended more than an hour ago. Run hourly by cron.

alter table public.session_calendar add column live_only boolean not null default false;

create or replace function public.due_sessions()
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
     and not c.live_only
     and c.date_end + interval '3 hours' <= now()
     and c.date_end + interval '3 hours' > now() - interval '14 days'
     and (s.session_key is null or s.windows_stored < s.windows)
     and c.download_attempts < 8
     and (c.last_attempt_at is null or c.last_attempt_at < now() - interval '30 minutes')
   order by c.date_end;
$$;

create function public.live_clear_finished()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  k integer;
  n integer := 0;
begin
  for k in
    select distinct l.session_key
      from (select session_key from public.live_rows union select session_key from public.live_buckets) l
      left join public.stored_sessions s on s.session_key = l.session_key
      left join public.session_calendar c on c.session_key = l.session_key
     where (s.windows > 0 and s.windows_stored >= s.windows)
        or (c.live_only and c.date_end + interval '1 hour' < now())
  loop
    perform public.live_clear(k);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.live_clear_finished() from public, anon, authenticated;

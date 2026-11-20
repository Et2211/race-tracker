-- One request schedule for OpenF1, shared by every server instance. OpenF1's limits (60 a
-- minute, 6 a second with an account) are per account, but each Vercel instance used to space
-- its own requests, so two busy instances together could go over. Now every request asks this
-- function for a time to go at and waits until then.
--
-- Grants are handed out in time order, so a sliding window is exact: a new request may go once
-- it is p_min_gap_ms after the previous grant, and a minute after the grant p_per_minute back.

create table public.openf1_grants (
  at timestamptz not null
);
create index openf1_grants_at_idx on public.openf1_grants (at);

-- Milliseconds the caller should wait before sending its request (0: go now).
create function public.openf1_grant(p_per_minute integer, p_min_gap_ms integer)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  last_at timestamptz;
  window_start timestamptz;
  t timestamptz;
begin
  -- One caller at a time, for the length of this transaction.
  perform pg_advisory_xact_lock(hashtext('openf1_grant'));
  delete from public.openf1_grants where at < clock_timestamp() - interval '2 minutes';
  select max(at) into last_at from public.openf1_grants;
  select g.at into window_start from public.openf1_grants g order by g.at desc offset p_per_minute - 1 limit 1;
  t := greatest(
    clock_timestamp(),
    coalesce(last_at + make_interval(secs => p_min_gap_ms / 1000.0), '-infinity'),
    coalesce(window_start + interval '1 minute', '-infinity')
  );
  insert into public.openf1_grants (at) values (t);
  return greatest(0, ceil(extract(epoch from (t - clock_timestamp())) * 1000))::integer;
end;
$$;

alter table public.openf1_grants enable row level security;
revoke all on public.openf1_grants from anon, authenticated;
revoke execute on function public.openf1_grant(integer, integer) from public, anon, authenticated;

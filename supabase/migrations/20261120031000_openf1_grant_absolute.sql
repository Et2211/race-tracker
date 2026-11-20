-- openf1_grant() returned how long to wait, but callers start waiting only when the answer
-- arrives, so differing round trips bunched requests up (two sent in the same millisecond in a
-- test). Return the time to send at instead (epoch milliseconds); callers wait until then.

drop function public.openf1_grant(integer, integer);

create function public.openf1_grant(p_per_minute integer, p_min_gap_ms integer)
returns bigint
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
  return ceil(extract(epoch from t) * 1000)::bigint;
end;
$$;

revoke execute on function public.openf1_grant(integer, integer) from public, anon, authenticated;

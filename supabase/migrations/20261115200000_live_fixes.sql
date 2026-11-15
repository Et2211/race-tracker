-- Live mode fixes after review.
--
-- 1. Writes for a session take a transaction-scoped advisory lock, so revision numbers become
--    visible in the order they were handed out. Without it, a slow write holding rev 100 could
--    commit after a quick one holding rev 101, and a viewer who had already read 101 would never
--    see 100.
-- 2. Seconds of car data carry a revision too, and a version with more samples replaces one with
--    fewer (a relay that reconnected, or joined mid-second, may have written a partial second).
--    Viewers read "changed since revision", so a second that is filled in or improved later still
--    reaches them.
-- 3. A row fetched over REST may fill in a version from the feed that has fewer fields set (a lap
--    that gained its time while no relay was connected); it never removes fields, and the feed's
--    msg_id is kept so later feed versions still win.
-- 4. Relays that have ended no longer count as alive, and the status no longer counts every stored
--    second on each poll.
-- 5. live_clear_downloaded() removes live rows of sessions that have since been downloaded in full,
--    however that happened (the daily calendar job calls it).

-- Values that are set (not null) in a JSON object.
create function public.live_set_fields(p jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select count(*)::integer from jsonb_each(p) where value <> 'null'::jsonb;
$$;

alter table public.live_buckets add column rev bigint not null default nextval('public.live_rev');
create index live_buckets_rev_idx on public.live_buckets (session_key, rev);

create or replace function public.live_upsert_rows(p_session_key integer, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer;
begin
  perform pg_advisory_xact_lock(1347, p_session_key);
  insert into public.live_rows (session_key, topic, key, msg_id, payload)
  select p_session_key, r.topic, r.key, r.msg_id, r.payload
    from jsonb_to_recordset(p_rows) as r(topic text, key text, msg_id bigint, payload jsonb)
  on conflict (session_key, topic, key) do update
    set msg_id = coalesce(excluded.msg_id, public.live_rows.msg_id),
        payload = excluded.payload,
        rev = nextval('public.live_rev')
    where (excluded.msg_id is not null and (public.live_rows.msg_id is null or excluded.msg_id > public.live_rows.msg_id))
       or (excluded.msg_id is null and public.live_rows.msg_id is null and excluded.payload is distinct from public.live_rows.payload)
       or (excluded.msg_id is null and public.live_rows.msg_id is not null
           and public.live_set_fields(excluded.payload) > public.live_set_fields(public.live_rows.payload));
  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function public.live_put_buckets(p_session_key integer, p_buckets jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  added integer;
begin
  perform pg_advisory_xact_lock(1347, p_session_key);
  insert into public.live_buckets (session_key, second, samples, data)
  select p_session_key, b.second, b.samples, decode(b.data, 'base64')
    from jsonb_to_recordset(p_buckets) as b(second bigint, samples integer, data text)
  on conflict (session_key, second) do update
    set samples = excluded.samples, data = excluded.data, rev = nextval('public.live_rev')
    where excluded.samples > public.live_buckets.samples;
  get diagnostics added = row_count;
  return added;
end;
$$;

create function public.live_buckets_since(p_session_key integer, p_rev bigint, p_limit integer default 1000)
returns table (second bigint, data text, rev bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.second, encode(b.data, 'base64'), b.rev
    from public.live_buckets b
   where b.session_key = p_session_key and b.rev > p_rev
   order by b.rev
   limit p_limit;
$$;

drop function public.live_status(integer);
create function public.live_status(p_session_key integer)
returns table (first_second bigint, last_second bigint, last_rev bigint, last_bucket_rev bigint, relays_alive integer, last_seen timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select (select min(second) from public.live_buckets where session_key = p_session_key),
         (select max(second) from public.live_buckets where session_key = p_session_key),
         (select max(rev) from public.live_rows where session_key = p_session_key),
         (select max(rev) from public.live_buckets where session_key = p_session_key),
         (select count(*)::integer from public.live_relays
           where session_key = p_session_key and last_seen > now() - interval '20 seconds' and coalesce(note, '') not like 'ended%'),
         (select max(last_seen) from public.live_relays where session_key = p_session_key);
$$;

create function public.live_clear_downloaded()
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
      join public.stored_sessions s on s.session_key = l.session_key
     where s.windows > 0 and s.windows_stored >= s.windows
  loop
    perform public.live_clear(k);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.live_set_fields(jsonb) from public, anon, authenticated;
revoke execute on function public.live_buckets_since(integer, bigint, integer) from public, anon, authenticated;
revoke execute on function public.live_status(integer) from public, anon, authenticated;
revoke execute on function public.live_clear_downloaded() from public, anon, authenticated;

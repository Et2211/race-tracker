-- Live sessions, from OpenF1's real-time feed (MQTT over WebSocket, paid tier).
--
-- Relays started every minute by Supabase Cron each hold a connection for ~150 s, so two or three
-- overlap and none of the feed is missed when one ends. They all write the same data; these tables
-- keep exactly one copy:
--   live_rows     low-rate topics (laps, race control, positions, ...): one row per record, keyed by
--                 its natural identity; a newer version (higher OpenF1 _id) replaces an older one.
--   live_buckets  car positions and telemetry, one gzipped row per second of session time, keyed by
--                 the data's own timestamp so every relay computes the same bucket; first write wins.
--   live_relays   each relay's heartbeat, for the "connected / stale" indicator.
-- Once a session is final and downloaded the normal way, its live rows are removed.

create sequence public.live_rev;

create table public.live_rows (
  session_key integer not null,
  topic text not null,
  key text not null,
  -- OpenF1's message _id (ever increasing); null for rows fetched over REST to fill a gap.
  msg_id bigint,
  payload jsonb not null,
  -- Changes on every insert or update, so readers can ask for "everything since".
  rev bigint not null default nextval('public.live_rev'),
  primary key (session_key, topic, key)
);
create index live_rows_rev_idx on public.live_rows (session_key, rev);

create table public.live_buckets (
  session_key integer not null,
  second bigint not null, -- epoch seconds of the session time the bucket covers
  samples integer not null,
  data bytea not null,    -- gzipped JSON: {"loc": [[driver, ms, x, y], ...], "car": [[driver, ms, speed, throttle, brake, gear, rpm], ...]}
  primary key (session_key, second)
);

create table public.live_relays (
  relay_id uuid primary key,
  session_key integer not null,
  started_at timestamptz not null default now(),
  subscribed_at timestamptz,
  last_seen timestamptz not null default now(),
  messages integer not null default 0,
  note text
);
create index live_relays_session_idx on public.live_relays (session_key, last_seen);

-- The session running now, give or take: from 20 minutes before it starts (drivers, the formation
-- lap) to 30 minutes after its scheduled end (overruns, the flag, results).
create function public.live_session_now()
returns setof public.session_calendar
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
    from public.session_calendar c
   where not c.is_cancelled
     and now() between c.date_start - interval '20 minutes' and c.date_end + interval '30 minutes'
   order by c.date_start
   limit 1;
$$;

-- p_rows: [{"topic": "v1/laps", "key": "...", "msg_id": 123 | null, "payload": {...}}, ...]
-- A row from the feed replaces the stored one only if it is newer; a REST row (no msg_id) only
-- fills a gap or refreshes another REST row.
create function public.live_upsert_rows(p_session_key integer, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer;
begin
  insert into public.live_rows (session_key, topic, key, msg_id, payload)
  select p_session_key, r.topic, r.key, r.msg_id, r.payload
    from jsonb_to_recordset(p_rows) as r(topic text, key text, msg_id bigint, payload jsonb)
  on conflict (session_key, topic, key) do update
    set msg_id = excluded.msg_id, payload = excluded.payload, rev = nextval('public.live_rev')
    where (excluded.msg_id is not null and (public.live_rows.msg_id is null or excluded.msg_id > public.live_rows.msg_id))
       or (excluded.msg_id is null and public.live_rows.msg_id is null and excluded.payload is distinct from public.live_rows.payload);
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- p_buckets: [{"second": 1789305990, "samples": 140, "data": "<base64 gzip>"}, ...]; first write wins.
create function public.live_put_buckets(p_session_key integer, p_buckets jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  added integer;
begin
  insert into public.live_buckets (session_key, second, samples, data)
  select p_session_key, b.second, b.samples, decode(b.data, 'base64')
    from jsonb_to_recordset(p_buckets) as b(second bigint, samples integer, data text)
  on conflict (session_key, second) do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;

create function public.live_rows_since(p_session_key integer, p_rev bigint, p_limit integer default 5000)
returns table (topic text, key text, payload jsonb, rev bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.topic, r.key, r.payload, r.rev
    from public.live_rows r
   where r.session_key = p_session_key and r.rev > p_rev
   order by r.rev
   limit p_limit;
$$;

create function public.live_buckets_between(p_session_key integer, p_from bigint, p_to bigint)
returns table (second bigint, data text)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.second, encode(b.data, 'base64')
    from public.live_buckets b
   where b.session_key = p_session_key and b.second >= p_from and b.second < p_to
   order by b.second;
$$;

create function public.live_status(p_session_key integer)
returns table (first_second bigint, last_second bigint, buckets bigint, last_rev bigint, relays_alive integer, last_seen timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select (select min(second) from public.live_buckets where session_key = p_session_key),
         (select max(second) from public.live_buckets where session_key = p_session_key),
         (select count(*) from public.live_buckets where session_key = p_session_key),
         (select max(rev) from public.live_rows where session_key = p_session_key),
         (select count(*)::integer from public.live_relays where session_key = p_session_key and last_seen > now() - interval '20 seconds'),
         (select max(last_seen) from public.live_relays where session_key = p_session_key);
$$;

-- Removes a session's live data (once it has been downloaded the normal way). Truncates when it is
-- the only live session stored, so the space is given back straight away.
create function public.live_clear(p_session_key integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from public.live_rows where session_key <> p_session_key)
     and not exists (select 1 from public.live_buckets where session_key <> p_session_key) then
    truncate public.live_rows, public.live_buckets;
    delete from public.live_relays;
  else
    delete from public.live_rows where session_key = p_session_key;
    delete from public.live_buckets where session_key = p_session_key;
    delete from public.live_relays where session_key = p_session_key;
  end if;
end;
$$;

alter table public.live_rows enable row level security;
alter table public.live_buckets enable row level security;
alter table public.live_relays enable row level security;
revoke all on public.live_rows, public.live_buckets, public.live_relays from anon, authenticated;
revoke all on sequence public.live_rev from anon, authenticated;
revoke execute on function public.live_session_now() from public, anon, authenticated;
revoke execute on function public.live_upsert_rows(integer, jsonb) from public, anon, authenticated;
revoke execute on function public.live_put_buckets(integer, jsonb) from public, anon, authenticated;
revoke execute on function public.live_rows_since(integer, bigint, integer) from public, anon, authenticated;
revoke execute on function public.live_buckets_between(integer, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.live_status(integer) from public, anon, authenticated;
revoke execute on function public.live_clear(integer) from public, anon, authenticated;

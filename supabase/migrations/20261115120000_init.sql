-- Race Tracker: session store index and learned marshal-sector positions.
-- Session data itself (gzipped JSON) lives in the private "sessions" storage bucket.
-- Only the server, using the project's secret key, reads or writes any of this.

-- Sessions downloaded from OpenF1 into the bucket.
create table public.stored_sessions (
  session_key integer primary key,
  year smallint not null,
  meeting_name text not null,
  session_name text not null,
  circuit_key integer not null,
  -- 15-minute telemetry windows the session has, and how many are stored.
  windows smallint not null check (windows >= 0),
  windows_stored smallint not null default 0 check (windows_stored >= 0),
  -- Bytes stored for the session (gzipped), kept for the storage cap.
  bytes bigint not null default 0 check (bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.stored_sessions is 'Sessions stored in the "sessions" bucket; drives the storage cap and the picker''s downloaded markers.';

-- Where cars stopped on the racing line under isolated yellow flags, used to place marshal
-- sectors on circuits without MultiViewer data. One row per car per session per sector.
create table public.marshal_observations (
  id bigint generated always as identity primary key,
  circuit_key integer not null,
  sector smallint not null check (sector > 0),
  -- Decimetres along the lap from the start line, on the outline drawn from OpenF1 positions.
  arc_dm integer not null check (arc_dm >= 0),
  session_key integer not null,
  driver_number smallint not null,
  stopped_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (circuit_key, sector, session_key, driver_number)
);

create index marshal_observations_circuit_idx on public.marshal_observations (circuit_key);

comment on table public.marshal_observations is 'Learned marshal-sector positions; written by npm run backtest -- --learn.';

-- Atomic size bookkeeping for concurrent downloads.
create function public.add_stored_bytes(p_session_key integer, p_bytes bigint, p_window boolean)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.stored_sessions
     set bytes = bytes + p_bytes,
         windows_stored = windows_stored + case when p_window then 1 else 0 end,
         updated_at = now()
   where session_key = p_session_key;
$$;

-- Locked down: row-level security with no policies, and no privileges for the public roles.
alter table public.stored_sessions enable row level security;
alter table public.marshal_observations enable row level security;
revoke all on public.stored_sessions, public.marshal_observations from anon, authenticated;
revoke execute on function public.add_stored_bytes(integer, bigint, boolean) from public, anon, authenticated;

-- Private bucket for gzipped session files (largest are ~0.6 MB; free plan allows 50 MB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sessions', 'sessions', false, 52428800, array['application/gzip']);

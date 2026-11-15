-- One download per item at a time across every server instance. A request that wants to download
-- a session's metadata or a telemetry window first claims its lock; others wait until it is
-- released and then read the stored result. A lock expires on its own, so a crashed instance
-- cannot block a session for longer than its time-to-live.
create table public.download_locks (
  key text primary key,
  holder uuid not null,
  expires_at timestamptz not null
);

-- True if the caller now holds the lock: it was free, or the previous holder's lock had expired.
create function public.claim_download(p_key text, p_holder uuid, p_ttl_seconds integer)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.download_locks (key, holder, expires_at)
  values (p_key, p_holder, now() + make_interval(secs => p_ttl_seconds))
  on conflict (key) do update
    set holder = excluded.holder, expires_at = excluded.expires_at
    where public.download_locks.expires_at < now();
  return found;
end;
$$;

-- Releases the lock if the caller still holds it.
create function public.release_download(p_key text, p_holder uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.download_locks where key = p_key and holder = p_holder;
$$;

-- True while someone holds an unexpired lock on the key.
create function public.download_running(p_key text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from public.download_locks where key = p_key and expires_at >= now());
$$;

alter table public.download_locks enable row level security;
revoke all on public.download_locks from anon, authenticated;
revoke execute on function public.claim_download(text, uuid, integer) from public, anon, authenticated;
revoke execute on function public.release_download(text, uuid) from public, anon, authenticated;
revoke execute on function public.download_running(text) from public, anon, authenticated;

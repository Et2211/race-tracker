-- 1. Download locks get a heartbeat: the holder extends its lock while it works, so the lock can
--    be short (a crashed holder blocks a session for about a minute, not four) without a slow but
--    healthy download losing it to a second downloader.
-- 2. live_clear: Supabase refuses a DELETE without a WHERE clause from the API, which made the
--    "only live session" branch fail. Say "where true".

-- True if the caller still holds the lock and it now lasts p_ttl_seconds from now.
create function public.extend_download(p_key text, p_holder uuid, p_ttl_seconds integer)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.download_locks
     set expires_at = now() + make_interval(secs => p_ttl_seconds)
   where key = p_key and holder = p_holder;
  return found;
end;
$$;

create or replace function public.live_clear(p_session_key integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from public.live_rows where session_key <> p_session_key)
     and not exists (select 1 from public.live_buckets where session_key <> p_session_key) then
    truncate public.live_rows, public.live_buckets;
    delete from public.live_relays where true;
  else
    delete from public.live_rows where session_key = p_session_key;
    delete from public.live_buckets where session_key = p_session_key;
    delete from public.live_relays where session_key = p_session_key;
  end if;
end;
$$;

revoke execute on function public.extend_download(text, uuid, integer) from public, anon, authenticated;

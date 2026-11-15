-- Race Tracker: scheduled jobs. Run once in the Supabase SQL editor after the app is deployed
-- (Dashboard > SQL Editor), replacing the two placeholders. Not a migration because it holds
-- deployment-specific values.
--
-- 1. The same random secret as the app's CRON_SECRET environment variable on Vercel
--    (generate one with: openssl rand -hex 32). It is kept in Supabase Vault, not in this file.
select vault.create_secret('<CRON_SECRET>', 'race_tracker_cron_secret', 'Bearer token for the app''s /api/cron endpoints');
-- 2. The app's production address, without a trailing slash.
select vault.create_secret('https://<your-app>.vercel.app', 'race_tracker_app_url', 'Where the scheduled jobs call');

-- Daily at 04:30 UTC: copy the published schedule into session_calendar (reschedules, cancellations).
select cron.schedule('race-tracker-calendar', '30 4 * * *', $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'race_tracker_app_url') || '/api/cron/calendar',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'race_tracker_cron_secret')),
    timeout_milliseconds := 60000
  );
$$);

-- Every 15 minutes: only when a session is final and not yet stored, ask the app to download it.
-- Most runs find nothing due and make no request at all.
select cron.schedule('race-tracker-download-due', '*/15 * * * *', $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'race_tracker_app_url') || '/api/cron/download',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'race_tracker_cron_secret')),
    timeout_milliseconds := 295000
  )
  where exists (select 1 from public.due_sessions());
$$);

-- To check:   select jobname, schedule, active from cron.job;
--             select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;
--             select status_code, content, created from net._http_response order by created desc limit 10;
-- To remove:  select cron.unschedule('race-tracker-download-due'); select cron.unschedule('race-tracker-calendar');

-- Live mode: while a session is on (from 20 minutes before to 30 minutes after, per
-- live_session_now()), start a relay every minute. Each holds OpenF1's real-time feed for ~150 s,
-- so two or three overlap and nothing is missed between them. The endpoint answers at once and
-- does nothing without OpenF1 credentials, so this job is harmless before you subscribe.
-- (Needs migration 20261115190000_live.sql.)
select cron.schedule('race-tracker-live-relay', '* * * * *', $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'race_tracker_app_url') || '/api/live/relay',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'race_tracker_cron_secret')),
    timeout_milliseconds := 10000
  )
  where exists (select 1 from public.live_session_now());
$$);

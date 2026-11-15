# Progress log

Overnight run, 2026-11-14/15. The owner allowed all milestones to be built without stopping at the gates. M7 (live mode) is deliberately not started: the brief excluded it and the paid OpenF1 tier is not set up. Nothing has been committed or deployed.

Checks are run with `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` unless noted.

## M0 — Repo audit and setup ✅

See the summary given in chat on 2026-11-14. Added Vitest, `typecheck`/`test` scripts, `.env.example`, a README skeleton; `@types/node` moved to `^24`.

## M1 — Data spike ✅ (owner reviewed)

Report: [`m1-findings.md`](m1-findings.md). Owner answers: Vercel Hobby, no paid storage, reference sessions accepted, any session must be downloadable on demand, fixtures size fine, MultiViewer data may be fetched by the server and cached.

## M2 — Dashboard from the mock ✅

What exists:
- `app/page.tsx` (session chooser) and `app/session/[key]/page.tsx` (dashboard).
- Components: `track-map`, `flag-panels`, `timing-tables`, `gap-chart`, `session-picker`, `dashboard`.
- Styles from the mock's tokens in `app/globals.css`; fonts Barlow, Barlow Condensed, JetBrains Mono via `next/font`.
- Tables are semantic `<table>` with `<th scope>`; purple/green carry a shape (◆/▲) and hidden text, and a legend.
- Team colours come from `drivers.team_colour`; a missing colour is grey, not guessed.

Checks: Playwright screenshots at 1440 px and 375 px for the clear, yellow-with-stopped-car, VSC, full safety car (Silverstone 2026, lap 48), double-yellow-with-highlight and double-yellow-with-no-car states; axe-core: **0 violations** on every page and width; no horizontal scroll at 375 px.

Deviations from the mock (deliberate):
- The mock's scenario switch is replaced by real moments of real sessions (the replay itself).
- A flagged sector is highlighted only when its position is known (MultiViewer markers, or ≥ 2 agreeing learned observations). Otherwise the panel says the position is not known and the stopped car's actual spot is ringed. Madring has no MultiViewer file, so its flags are text only.
- The map shows each car's number with a team-coloured rim, plus a dashed ring where a car stopped.
- The map is the racing line of one lap, drawn from OpenF1 data, rotated with MultiViewer's display angle when there is one.

## M3 — Historical data layer and replay ✅

Design:
- **Storage** (`lib/storage/store.ts`): gzipped JSON in Vercel Blob (private) when `BLOB_READ_WRITE_TOKEN` is set, else `.cache/store` on disk (gitignored). **The Blob backend has not been run against a real store** (no project or store was created overnight).
- **Ingest** (`lib/session/ingest.ts`), driven by the browser one step at a time so every step fits in a 300 s Hobby function and progress is visible:
  1. Metadata: session, meeting, drivers, laps, race control, positions, intervals, pits, results, the meeting's qualifying, the outline lap's location, the MultiViewer file (≈ 15 OpenF1 requests, measured 27.6 s).
  2. One request per 15-minute telemetry window (location + car data, split automatically on HTTP 422), measured 6–11 s each.
- **Measured**: Spanish GP race, full first-time ingest ≈ 80 s; stored size **4.7 MB** (meta 440 KB + 7 windows of ~620 KB). Vercel Blob's free 1 GB holds about 200 races; each race costs 8 upload operations of the 2 000 a month included.
- Sessions that ended less than 3 hours ago are refused (OpenF1 is still adding results).
- Replay span comes from the running (first lap / session start to last finish + 3 min), not the scheduled `date_end`, which red-flagged sessions overrun.
- **Session picker**: season → Grand Prix → session (Race, Sprint, Qualifying, Sprint Qualifying), 2023 onwards, from `/api/catalog/[year]` (cached; the current season refreshes every 6 h).
- **Replay** runs in the browser: every panel is a pure function of (session data, time), so play, pause, speeds 1–16×, scrubbing, jump to lap (race) or to Q1/Q2/Q3 (qualifying), and jumping backwards all stay consistent. Tables and flags recompute 5× a second; car dots every frame.
- When the playhead is somewhere whose telemetry has not downloaded yet, the map says so; the window under the playhead downloads first.
- `F1_DATA_MODE=fixtures` serves only the four recorded sessions with no network.

Checks: ingested the Spanish GP race via the API and the São Paulo GP race through the UI from empty (≈ 85 s), screenshots as above.

Open points:
- Fixtures are now 14.7 MB (the São Paulo race was added for the highlighted-sector state). The owner approved 7.8 MB; the São Paulo windows can be trimmed if that matters.
- The OpenF1 throttle is per server instance; two people ingesting at once on different instances could exceed 30 requests a minute. The client retries on 429 with a visible message.

## M4 — Timing panels ✅

- Qualifying (`lib/timing/qualifying.ts`): best valid lap per driver per phase (phases from race-control "SESSION STARTED" with `qualifying_phase`), purple = fastest in the phase, green = the driver's best of the session, elimination line from the size of the next phase's field, ideal lap from session-best sectors. Laps deleted by race control ("TIME … DELETED", "LAP DELETED") are removed; "WILL BE REINSTATED" puts them back.
- Race (`lib/timing/race.ts`): order from the position feed, gap and interval from the latest intervals row (stale after 15 s), last completed lap's splits, purple = fastest sector of the race so far, green = personal best so far, gap trend over the last 10 laps from line-crossing times with lapped cars left out.
- After the chequered flag the race panel lists where the official result differs from the order on track.

Spot checks against official results:
- Qualifying: every driver's best time in every phase equals `session_result.duration` for Madrid and São Paulo (unit test).
- Race order at the flag equals the official classification for Madrid. For São Paulo it differs for LEC and LAW: LEC finished ahead on track, but the official gap is exactly 5.000 s more than the feed's (a post-race penalty), so LAW is P7. The dashboard now says so (unit test).
- Final gaps from the intervals feed equal the official gaps to the millisecond for every classified car in both races, apart from that penalty and one feed quirk: #12 (P5 in São Paulo) has a `null` gap at the finish, which OpenF1 documents as "leader". Null is now treated as leader only for the car in P1.

Tests: 38 unit tests (`npm test`).

## M5 — Track map ✅

- Outline, sector colouring, car dots every animation frame, driver selection shared between map and tables (click a dot or a row).
- Playback at 16× measured in headless Chromium: **60 fps, p95 frame 16.8 ms, no long tasks** on Madrid, Spa and Baku.
- Circuits checked by ingesting from empty through the UI and playing: Madring (new, street), Spa (long), Baku (street), São Paulo; Kuala Lumpur and the Monaco race (no position data) — see below. Spa took 73 s and Baku 79 s to download the first time.

| Circuit | Session | First download | 16× playback | Notes |
| --- | --- | --- | --- | --- |
| Madring (new, street) | 2026 race 11369 | ≈ 80 s | 60 fps | No MultiViewer file: flags named, not drawn |
| Interlagos | 2026 race 11412 | ≈ 85 s | — | Flagged sector drawn from MultiViewer markers; map rotated to TV orientation |
| Spa (long) | 2026 race 11334 | 73 s | 60 fps | |
| Baku (street) | 2026 race 11377 | 79 s | 60 fps | |
| Kuala Lumpur (added 2026) | 2026 race 11731 | 82 s | 60 fps | No MultiViewer file |
| Monte Carlo | 2026 race 11299 | 91 s | — | OpenF1 has no position data for this race: the outline is taken from qualifying (and says so), no cars are shown and the map says why; flags are listed but stopped cars are not looked for |

Change made after the Monaco check: a downloaded window can be empty, so the map and the flag panel now check for actual position samples before showing cars or saying "no stopped car found".

## M6 — Flags and stopped-car inference ✅ (owner accepted the accuracy on 2026-11-15)

Built:
- Flag state from race control (`lib/flags/state.ts`): sector flags grouped per incident (incident sector + warning sector), VSC/SC, red flag held until the session restarts (not cleared by "TRACK CLEAR"), flags closed at chequered flag and session boundaries. Checked against all 52 completed 2026 sessions: 939 flag episodes; 72 never receive a CLEAR, so flags older than 10 minutes say "no clear message received" instead of being hidden or expired.
- Flag highlight on the map: MultiViewer markers (sector N to N+1) where a file exists; otherwise learned positions with two independent observations within 100 m; otherwise the sector is named but not drawn, and the panel says so.
- Stopped-car panel (`lib/incident/stopped.ts`, `lib/incident/stretch.ts`, `lib/incident/messages.ts`): cars below 30 km/h on the racing line from 30 s before the flag to 5 s after, having been above 100 km/h in the 40 s before, excluding pit stops and the start; possible contact (another car within 20 m whose speed fell 60 km/h in under a second); race-control messages that name cars are parsed (with the bracketed local incident time) and raise the confidence to "high". Cars that stopped outside a known flagged stretch are shown as "stopped elsewhere" and do not count. No inference under a red flag, after the finish, without position data, or without loaded data — each says why.
- Backtest: `npm run backtest -- --ablate --sweep --learn` → [`m6-backtest.md`](m6-backtest.md).

Backtest result (32 sessions of 2026: every race and sprint plus six qualifying sessions; 221 flag incidents with position data, 134 of them in green-flag running):

| Green-flag incidents | Count | Meaning |
| --- | --- | --- |
| Car shown, later confirmed | 25 | race control names it in an incident at that time, or it retired there |
| Car shown, contradicted | 2 | race control names other cars |
| Car shown, never confirmed or contradicted | 31 | typically a spin with no stewards' note |
| Nothing shown, cars named | 12 | mostly contact without a stop, or a car stopped off the racing line |
| Nothing shown, nothing named | 64 | debris, marshals, a car off line |

- Where markers exist, 50 of 53 first stops lie inside the flagged stretch.
- Threshold choice: 30 km/h and 30 s placed stops in the right stretch most often (94 % vs 86 % for the first guess of 20 km/h and 60 s) with the same confirmed count. A pit-limiter exclusion rule was tried and removed: it dropped three confirmed cars and gained nothing.
- Learned marshal-sector positions agree with MultiViewer in 39 of 40 checkable cases. Learned so far: Madring sector 23 (two cars within 1 m, both from the same race) and Kuala Lumpur sectors 4 and 15 (one car each). A session's own stops are never used to draw its sectors (otherwise a replay would draw a sector from the incident it is showing, or from later in the race), so none of these are drawn yet; they will be once a second session at those circuits is ingested.
- A known cost of the conservative rule: at Silverstone (lap 48, 2026) VER stopped one second before "DOUBLE YELLOW IN TRACK SECTOR 15" and stayed stopped, but 5 010 m into the lap, outside sector 15 as drawn by MultiViewer's 2022 markers; he is listed as "stopped elsewhere" with confidence "none". Either the 2022 markers are out of date for 2026 or he was not that flag's incident; the dashboard does not guess.

What the confidence levels mean, from these numbers:
- **Medium**: a car stopped on the racing line in the flagged stretch (or, without known limits, anywhere on the line) around the flag. About 4 in 10 are later confirmed by race control or a retirement, about 1 in 30 is contradicted, the rest are never mentioned.
- **High**: in addition, race control names that car in an incident at the same time.
- **None**: nothing stopped; 12 of 76 such green-flag incidents did involve named cars, so "no stopped car found" does not mean nobody was involved — the wording says only that no car stopped.

**Owner decision (2026-11-15)**: accuracy accepted as is, with the current wording. The UI never states fault and always says the result is calculated, not reported.

## M7 — Live mode ⏭ not started

Excluded by the brief and needs the paid OpenF1 tier. M1 §11 has the relay design (SSE with resume from shared storage; Hobby allows 300 s per connection).

## M8 — Hardening ✅

- Every panel has loading, empty and error states: session loading and ingest progress, ingest errors with retry, telemetry download progress and failures with retry, no outline, no position data (whole session or a moment), no gaps, no timed laps in a phase, no race-control messages yet, inference not possible (not loaded / no positions / red flag / after finish).
- Rate limits: requests spaced 2.1 s per server instance; 404 means empty; 422 splits the window; 429 and 5xx retry with backoff, then report "rate limit reached, try again in a minute".
- Data-quality handling added from real sessions: race-control rows from another day dropped (Mexico City 2026 race had one, which stretched the replay to 29 h); `null` gap treated as leader only for P1 (São Paulo 2026, P5); empty telemetry windows (Monaco 2026 race; most of Zandvoort 2026 qualifying) reported as "no position data".
- README rewritten: setup, scripts, environment variables, how it works, data sources, limitations.
- Tests: 44 unit tests; 12 end-to-end tests (6 scenarios × desktop and phone) in fixture mode with axe accessibility checks.
- **Clean checkout**: the files a commit would contain were copied to an empty folder; `npm ci`, lint, typecheck, unit tests, build and the end-to-end suite all passed there.

## Things to know

- **Storage cap**: before downloading a new session the server checks a running size estimate in one small manifest file and refuses above `STORE_CAP_MB` (default 900 MB) with a visible "storage full" message, because Vercel Blob on Hobby is suspended for 30 days if its 1 GB is exceeded. Tested with a 1 MB cap (refused after one OpenF1 request, nothing written). There is no eviction; old sessions must be deleted by hand. The 32 sessions already on disk predate the manifest and are not counted.
- **Before deploying**: the API routes that download sessions are not authenticated. Anyone who finds the URL can trigger downloads and use up the Blob upload quota and OpenF1 rate limit. Fine for a private URL; add a simple shared secret before sharing it.
- The picker shows "Grand Prix · circuit" because OpenF1 names the October 2026 Kuala Lumpur round "Bahrain Grand Prix".
- `next dev` may write an agent-feedback block into `AGENTS.md` (the repo enables `experimental.agentFeedback`). I did not run its reporting command, which would send data to Vercel.
- The local store (`.cache/store`) holds the 32 sessions ingested tonight; it is gitignored.
- Nothing was committed, pushed or deployed. Per-milestone `git status`/`git diff` snapshots were saved outside the repo.

## Changes on 2026-11-15 (after review)

- **First-time download requests**: the browser no longer asks for stored data, gets a 404 and then asks again. One GET returns the stored copy or downloads it first. Concurrent requests for the same item share one download on the server (two simultaneous first requests: both 28.2 s, one download), and the browser shares the request too (React runs effects twice in development). Telemetry windows are cacheable by the browser for a year and metadata for a day; the last two sessions opened stay decoded in the tab. Redux Toolkit Query was considered and not used: the telemetry is typed arrays that cannot live in a Redux store, and the browser cache covers the rest.
- **Formation lap**: lap timing already excluded it (lap 1 starts at lights out in all 26 races checked). The labels did not: pre-race race-control messages showed "L1" and pre-race flags "Lap 1". Before lights out the log now shows "Pre", flags show no lap, the header says "Before the start · grid and formation lap", and the race panel says the order is the starting grid.
- **Driver selection**: clicking the selected driver again, clicking anywhere that is not a driver, or pressing Escape clears it.
- Checks: 47 unit tests, 14 end-to-end tests (desktop and phone), lint and typecheck clean.
- **Position changes animate**: race and qualifying rows slide to their new places when the order changes during playback (`components/use-row-flip.ts`, browser animation API, no new dependency). Jumps of more than 30 s of session time (scrubbing, jump to lap) snap instead, and nothing animates when the system asks for reduced motion. The qualifying panel beside a race shows the final result, so it does not move. 20 end-to-end tests.

## Supabase storage (2026-11-15)

- Supabase project `race-tracker` (free plan, eu-west-1). Migration `supabase/migrations/20261115120000_init.sql`, applied: tables `stored_sessions` (what is stored, real sizes, windows) and `marshal_observations` (learned positions, seeded with the 4 from `data/marshal-sectors`), an `add_stored_bytes` function, and a private `sessions` bucket (gzip only, 50 MB per file). Row-level security is on with no policies and the public roles have no privileges, so only the server's secret key can read or write; the security advisor reports only that intentional "RLS enabled, no policy" note.
- The store uses Supabase when `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are set, else the disk (development and tests). The Vercel Blob backend, never run against a real store, was removed.
- The storage cap and the picker's "· downloaded" markers come from `stored_sessions` (or a manifest beside the disk store, which counts sessions downloaded before it existed).
- Car telemetry stays as gzipped files in Storage rather than rows: ~1.2 million samples per race would pass the free plan's 500 MB database limit within a few races.
- `vercel.json` sets the functions' region to Dublin (`dub1`) to sit next to the Supabase project.
- `npm run store:upload` copies already-downloaded local sessions to Supabase.
- Verified against the real project: `npm run store:upload -- 11369` stored the Spanish GP race (8 files, 4.48 MB; the table row matches the files exactly); the app served its metadata in 0.63 s and a telemetry window in 0.47 s from Supabase; a first-time download of the 2024 São Paulo race through the app went straight into Supabase (10 windows, 110 s, 4.33 MB, row and files agree) and the dashboard renders it with no accessibility violations. Without the secret key, the bucket answers 400 and the table API 401.

## Automatic downloads from the calendar (2026-11-15)

- Migration `20261115140000_session_calendar.sql`, applied: `pg_cron` and `pg_net` enabled; `session_calendar` (the published schedule of race, sprint, qualifying and sprint-qualifying sessions, with download attempts and errors); `due_sessions()` returns sessions whose scheduled end + 3 h has passed (OpenF1's data is then final), that are not fully stored, became ready within the last 14 days, and have failed fewer than 8 times (retried every 30 min). Locked like the other tables.
- App endpoints, protected by `CRON_SECRET` (401 without it): `/api/cron/calendar` copies the season's schedule from OpenF1 (2 requests; from December also next season); `/api/cron/download` downloads due sessions completely on the server, stopping new work after 220 s so a run ends inside Vercel's 300 s limit and the next run carries on. `?session=<key>` forces one session.
- Supabase Cron jobs (`supabase/cron.sql`, to be run once the Vercel address exists): calendar daily at 04:30 UTC; every 15 minutes, call the download endpoint only if `due_sessions()` returns anything.
- The picker lists upcoming sessions with their start time in UTC; whether a session is upcoming, final or downloaded is worked out per request instead of being cached with the season list (cache key moved to `catalog/v2/`).
- Verified with a separate production build: both endpoints refuse requests without the secret; the calendar filled with 62 sessions of 2026 (Bahrain and Saudi Arabia marked cancelled; Las Vegas qualifying ready at 08:00 UTC on 21 Nov, race at 09:00 UTC on 22 Nov); `due_sessions()` is empty, as every session that ended in the last two weeks is stored; the download endpoint completes an already-stored session in 4 s. A real automatic download is still to be observed once deployed.

## Homepage and "Worth watching" (2026-11-15, branch `homepage`)

- **Homepage** (`app/page.tsx`, `components/home/`, `lib/home/data.ts`): season switcher (2023 to now); hero with the next session's countdown and circuit outline, or the champion once a season is over; latest race recap (podium, fastest lap, incidents); season calendar with every round's outline, winner, a "Watch the race" button and a chip per session; drivers' and constructors' standings; points-through-the-season chart of the top five (teammates dashed); storage gauge. The reference sessions block and the homepage picker are gone; the race page has "← All sessions".
- Drivers are written name first, then number ("Lando NORRIS #4") on the champion card, the standings, the podium and calendar winners.
- **Derived files**: each downloaded session also gets `sessions/{key}/summary.json` (a few kB: classification, drivers, fastest lap, incident counts) and updates `circuits/{circuitKey}.json` (a simplified outline, newest season wins). Upcoming rounds use the circuit's latest outline, labelled "2025 layout" when it is from an earlier season; a new circuit has none until its first session.
- **Standings** come from OpenF1's championship endpoints (beta), cached per race/sprint once final at `championship/{key}.json`, with the drivers of that session so names never depend on a stored session. The chart draws only rounds whose standings are cached and says how many are missing.
- `npm run backfill` wrote summaries and outlines for the 92 sessions already stored. Scripts run outside Next.js, so `scripts/tsconfig.json` maps the `server-only` guard to an empty module.
- **Worth watching** (`lib/timing/battles.ts`, `components/watch-panel.tsx`), races only, beside the map: consecutive cars within 1 s ("fight", described as DRS range up to 2025 and Overtake Mode range from 2026, which replaced DRS with extra electrical energy under the same one-second rule), within 2 s ("close"), or up to 5 s back and closing at least 0.2 s a lap so they would be within a second in 8 laps or fewer ("catching"). Gaps are the time between the two cars starting the same lap, over the last four crossings; the trend starts at either car's latest pit exit, so a stop is not read as catching; retired and lapped cars are left out. Hidden under a safety car, VSC or red flag, with the reason shown. Clicking a pair selects the chasing car. The panel links to F1 TV and NOW in a new window: both send `frame-ancestors` headers (`'self'` and `'none'`) that stop them being shown in an iframe, and their video is DRM-protected.
- Checks: 58 unit tests, 24 end-to-end runs (12 tests at desktop and phone sizes, axe on the homepage and dashboard), lint and typecheck clean.
- **Sync to video** (`lib/replay/sync.ts`, `components/sync-control.tsx`): for watching a recording of the broadcast (NOW, F1 TV) in another window or picture-in-picture. Pick a moment you will see on it (race: lights out, i.e. race control's SESSION STARTED, which is also every car's lap 1 start; then each lap as the leader crosses the line. Qualifying: each phase's start), press Now as it happens, and the replay jumps there (plus 0.25 s for reaction time), switches to 1× and plays. Nudge ±0.5 s / ±5 s to correct. Scrubbing, jumping or changing speed ends the sync; play/pause keeps it.
- **No password on downloads** (owner's decision): anyone can trigger a download, but only one per item runs at a time across all server instances. Migration `20261115170000_download_locks.sql`, applied: `download_locks` table and `claim_download` / `release_download` / `download_running` functions, locked like the other tables. `lib/storage/download-lock.ts`: the first request claims the item's lock (metadata 240 s, a telemetry window 150 s; it expires if the instance dies) and downloads; others poll the lock row every 2 s, then read the stored result, or try themselves if that download failed; after 240 s of waiting they answer 503 `busy` with Retry-After. The disk store (one process) needs no lock. Verified with two production servers against Supabase requesting the 2023 Azerbaijan sprint shootout at once: one logged `[download] session 9278: metadata` and took 19.3 s, the other waited and returned the stored copy at 20.6 s without downloading; stored bytes match the files exactly and no lock row was left.
- All races 2023–2026 are stored (90 downloaded in this run; three that failed on a local connection error succeeded on retry).
- Checks: 65 unit tests, 26 end-to-end runs, lint and typecheck clean.

## Tyres in "Worth watching", retired cars off the map (2026-11-15)

- Race and sprint metadata now keeps OpenF1's tyre `stints` (one more request per download; `DATA_FORMAT` 2 so browsers fetch the new shape). `npm run backfill -- --stints` adds them to races stored earlier.
- Each pair in "Worth watching" shows both cars' compound and tyre age. A pair is marked **Strategy** and ranked below real fights when the tyres are 10+ laps apart in age, or when one car has made its first stop and the other has not (dry races only; a switch to intermediates or wets is not a strategy stop). A different number of stops on similar tyres once both have stopped (Madrid lap 45, #55 two stops vs #77 one) stays a fight. Wording: DRS range up to 2025, Overtake Mode range from 2026.
- **Retired cars leave the map** (`lib/incident/retired.ts`): a car the result lists as DNF (or DNS) is hidden once it is on its final lap (the one with a start but no time) and has moved less than 20 m in 15 s (longer than any pit stop, penalties included), i.e. parked in the garage or where it broke down. Australia 2026: Alonso (#14) stops in the pits at 04:53:40 after a slow final lap and is gone at 04:53:57. While it is still moving it is drawn; under a flag, the dashed ring where it stopped stays. In Madrid, #44 (out on lap 7) is gone from the lap-14 window, and #18 is drawn until it has crawled to a halt (about 13:26:50) and sat still for a few seconds.
- `DATA_FORMAT` is 3: version 2 was served for a short while before the stints backfill finished, and browsers keep session data for a day, so a session opened then showed "tyres not known".
- **Race control keeps every message** up to the replay time (blue flags still left out), newest first, in a panel that scrolls on its own (keyboard-focusable; 26 rem tall, 20 rem on phones), with a count. Each message shows its lap and its time in UTC, matching the replay clock (messages' own text often ends with the track's local time).
- Checks: 76 unit tests, 32 end-to-end runs, lint and typecheck clean.

## Live mode (2026-11-15, branch `live-mode`; ready for OpenF1's paid tier, not paid for yet)

- **Design.** Supabase Cron calls `/api/live/relay` every minute while `live_session_now()` returns a session (20 min before the start to 30 min after the end). The route answers at once and, in `after()`, holds OpenF1's MQTT-over-WebSocket feed for 150 s (`LIVE_RELAY_SECONDS`), so 2–3 relays overlap (OpenF1 allows 10 connections) and Vercel's 300 s limit never matters. Without `OPENF1_USERNAME`/`OPENF1_PASSWORD` it does nothing.
- **Storage** (migration `20261115190000_live.sql`, applied): `live_rows` for low-rate topics, one row per record keyed by what it describes (a newer feed `_id` replaces an older version; REST rows only fill gaps); `live_buckets`, one gzipped row per second of car positions and telemetry, keyed by the samples' timestamps so every relay builds identical seconds, first write wins (~1.3 KB/s, ~10 MB per race); `live_relays` heartbeats. Postgres refuses one statement updating a record twice, so each write keeps one version per record; Supabase returns at most 1,000 rows from a function call, so reads page at 1,000. Rows are removed (`live_clear`) once the session has been downloaded the normal way.
- **Gaps.** A relay that finds no other relay alive fills the last 10 minutes from REST once it knows where its own complete seconds begin.
- **Browser.** `/live/<key>` (linked from the replay page's Live/Replay switch, the homepage hero and the calendar while a session is on) loads the session so far, then polls changed rows and the newest minute of car data every second (`lib/replay/use-live.ts`). The live clock runs at real time minus a delay, 3 s back from the newest data; Sync to video sets the delay from a moment pressed on the stream, pausing freezes it, the scrubber goes back over what has arrived, and "Back to your stream" / "Back to live" return. The track map uses the newest stored session at the circuit; there is no classification until OpenF1 publishes results, which the page says.
- **OpenF1 account.** `lib/openf1/auth.ts` exchanges the credentials for the 1-hour token (renewed a minute early, re-signed after a 401), which REST then sends (requests spaced for 6/s and 60/min) and MQTT uses as the password. Nothing reaches the browser: checked by recording every browser request on the live page (none to OpenF1 or the broker, no token in the page).
- **Testing without an account.** `npm run fake-openf1` serves the token endpoint, REST (only rows up to "now") and an MQTT broker replaying a stored race in real time with `_id`/`_key`, laps arriving in several versions. `npm run test:live` runs three overlapping relays against it in memory and checks the result against the source; it fails as it should when the relays are shortened so they no longer overlap (20 seconds missing, 4 laps stale). Against Supabase, five relays over five minutes stored 984 of 985 seconds; the one missing second has no data in the stored race either.
- **Day one.** Add the credentials to `.env.local` and Vercel, schedule `race-tracker-live-relay` from `supabase/cron.sql`, and run `npm run live:check` during a session to see the real topics and message shapes.
- Checks: 82 unit tests, 34 end-to-end runs, `npm run test:live`, lint and typecheck clean.

## Review fixes, toolbar and qualifying clock (2026-11-15, branch `live-mode`)

Four review agents (live mode; data and storage; replay performance; homepage and tests) reported; everything on the combined list was fixed except where noted.

**Live mode**
- Migration `20261115200000_live_fixes.sql` (applied): writes take a per-session advisory lock so revisions become visible in order (a viewer could otherwise skip a row for good); seconds of car data carry a revision and a version with more samples replaces a partial one; a REST row may fill fields a feed row lacks but never remove any; ended relays no longer count as alive; `live_clear_downloaded()`. Migration `20261115210000_lock_heartbeat_and_clear.sql` (applied): `extend_download` for lock heartbeats, and `live_clear` fixed (Supabase refuses a bare DELETE from the API, so the cleanup after a download would have failed; found by running `test:live` against Supabase).
- Relays: a relay's first complete second is the later of its subscription and its first sample; a second closes only when every data type still arriving has moved 4 s past it (a type quiet for 10 s no longer holds things up); failed writes keep their rows and seconds and retry; the gap fill runs whenever stored data is over 15 s old, retries three times and survives one topic failing; the token is asked for for the relay's whole life and refreshed before a reconnect.
- Browser: car data is read "changed since revision" (so gap fills and improved seconds still arrive) after loading the last two minutes; scrolling back loads earlier seconds; polling pauses in a hidden tab. `TelemetryIndex` appends in place instead of re-copying everything per piece. `mergeLiveRows` replaces only the arrays of topics that changed and appends in place. The live clock stays ~1 s behind the newest data so cars move smoothly (they moved once a second), catches up at 1.5× while following, and `syncTo` fixes syncing while paused. `/api/live/<key>` only serves the session on now or one with live data, and caches stored reads.
- `npm run test:live` now also runs a viewer polling the store and a 20 s gap that the next relay must fill; it passes in memory and against Supabase (`TEST_LIVE_SUPABASE=1`).

**Storage and cost**
- The download job lists a session's stored files instead of downloading each window to check it, and sets the counts from the listing when complete (a missed counter update could otherwise re-download a race every 30 minutes for 14 days, ~3 GB of egress). Attempts are recorded before starting. Locks are 60 s with a heartbeat every 20 s; waiters give up at 150 s.
- Session data is `public` (telemetry a year, metadata 5 min in the browser / 1 h at the CDN), so Vercel's CDN can serve it; errors are `no-store`. Routes send what they just built after a first download instead of reading it back; window downloads reuse the metadata for 10 minutes.
- Daily calendar job: fills missing championship tables, clears live rows of downloaded sessions, retries MultiViewer for the last two weeks, rebuilds the homepage season summary. `cron.sql`: calendar timeout 295 s, pruning of `cron.job_run_details`.
- OpenF1: a 429 holds back every request from the instance; a season's list counts as final only if fetched after the season; an OpenF1 failure falls back to the stored list.
- Homepage: one stored season summary per year (`home/v1/<year>.json`; outlines, winners, standings, points history) rebuilt when out of date, so a render reads one file and one database query instead of ~70; standings fall back to the newest cached round; empty standings are remembered for an hour; the next session is picked again in the browser.

**Replay performance**
- Panels re-render only when their inputs change (5 times a second at most, not every frame). Rows are indexed by time once per array and found by binary search (race table, leader's lap, battles, gap trend, log); the race-control log, the weekend's qualifying table, incidents and retirements are built once per session. The stopped-car scan stops at the end of its window. `buildStatic` is memoised on the fields it reads.

**Toolbar and qualifying**
- Two rows with a full-width scrubber; one shared style for toggles whatever element they are. The Live/Replay switch is gone: "Watch live" shows in the corner only while a session is on.
- Qualifying: a session-clock pill (time left in the phase, stopped under a red flag, the next phase's start), Q1/Q2/Q3 buttons that land 10 s before each start, and "Skip breaks" (on by default) that plays straight over the breaks between phases and red-flag stoppages. Phase lengths come from the data, or the format (Q1 18, Q2 15, Q3 13 min from 2026, 12 before; sprint 12/10/8).

**Tests and accessibility**: the points chart has a table alternative; cancelled rounds keep normal contrast; `<main>` is a real landmark; the scrubber's spoken value changes every 10 s, not every second; e2e homepage tests pin `?season=2026`; fixed waits replaced; the e2e store is cleared each run; a 360 px phone project runs the layout and axe tests.

**Not done**: metadata is still unzipped per request to apply learned marshal sectors (now behind the CDN cache); reviewer extras not on the list (24 h results refresh, a shared rate-limit row, Float32 telemetry). Whether `after()` keeps a relay alive for 150 s on Vercel needs a preview deploy to prove.

Checks: 97 unit tests, 37 end-to-end runs, `test:live` (memory and Supabase), lint and typecheck clean.

## Practice sessions: live, and replays streamed but never stored (2026-11-15)

- Owner's decision: practice is not worth storing. Migration `20261115220000_practice_live_only.sql` (applied): `session_calendar.live_only` (set for practice by the calendar job), `due_sessions()` skips it, `live_clear_finished()` clears live rows of sessions since downloaded and of practice an hour after it ends (cron `race-tracker-live-cleanup`, hourly, in `cron.sql`).
- A new `practice` session kind: the dashboard shows one table of best laps over the whole session (qualifying's table as a single phase, no eliminations), a sync point at the pit exit opening, and no lap jumps.
- Opening a past practice session builds it from OpenF1 and sends it without storing anything (metadata kept in memory for 10 minutes for its windows). Checked: São Paulo FP1 (11405) loaded in 10 s (570 laps, 6 windows), its first window in 7 s, and Supabase afterwards had no row, file or lock for it. The picker and calendar list practice ("loads from OpenF1, about 30 s"); the homepage hero and calendar link to the live page while one runs.
- Las Vegas: FP1 11413 (Fri 20 Nov 00:30 UTC), FP2 11414 (04:00), FP3 11415 (Sat 21 Nov 00:30). With practice in the calendar, relays start for them automatically: FP1 is a hands-off dry run of the full live path.
- End-to-end tests now run with no OpenF1 account or Supabase whatever `.env.local` holds.
- Checks: 101 unit tests, 37 end-to-end runs (Node 26), `test:live`, lint and typecheck clean.

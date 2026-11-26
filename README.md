# Speed Trace

An unofficial Formula 1 session dashboard. Pick any race, sprint or qualifying session from 2023 onwards and replay it: track map with car positions and the three timing sectors, qualifying sector times by phase, race gaps and splits with a gap trend, and yellow-flag highlighting with an estimate of which cars stopped.

Personal, non-commercial use only. Not affiliated with Formula 1, the FIA, OpenF1 or MultiViewer.

## Requirements

- Node.js 24 (see `engines` in `package.json`)
- npm

## Setup

```bash
npm install
cp .env.example .env.local    # optional: nothing is required for replay
npm run dev
```

Open http://localhost:3000 and choose a session. The first time a session is opened it is downloaded from OpenF1 (about a minute and a half for a race, with progress shown) and kept in `.cache/store`; after that it opens instantly.

To work offline, set `F1_DATA_MODE=fixtures`: only the four recorded sessions in `fixtures/openf1` are offered, and nothing is fetched.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Route types, then TypeScript in strict mode |
| `npm test` | Unit tests (Vitest), against recorded fixtures |
| `npm run test:e2e` | Build, then end-to-end tests (Playwright) in fixture mode at desktop and phone sizes, including axe accessibility checks. Run `npx playwright install chromium` once first. |
| `npm run ingest -- <session keys>` or `-- --year 2026 --type Race` | Download sessions into the store through a running server (`BASE_URL`, default `http://localhost:3000`) |
| `npm run backtest [-- --sweep] [-- --learn]` | Score the stopped-car inference against every downloaded session (local store); writes `docs/m6-backtest.md`. `--learn` records marshal-sector positions (to Supabase when configured, else `data/marshal-sectors`) |
| `npm run store:upload [-- <session keys>]` | Copy sessions from the local store to Supabase so they need not be fetched from OpenF1 again |
| `npm run backfill [-- --standings] [-- --stints]` | Write homepage summaries and circuit outlines for sessions stored before they existed (no OpenF1 calls). `--standings` also fetches the championship table after every race and sprint since 2023 (3 OpenF1 requests each; don't run it alongside a download). `--stints` adds tyre stints to races stored before they were kept |
| `npm run fake-openf1 [-- --session 11369 --lap 10]` | A local stand-in for OpenF1's paid tier: replays a stored session in real time, shifted to now, with the token endpoint, REST and the MQTT-over-WebSocket feed. For building and testing live mode without an account (see Live mode) |
| `npm run live:check [-- --seconds 60]` | With an OpenF1 account in `.env.local`: signs in, listens to the real-time feed and prints which topics arrive with an example of each (never the token). Run it on the day you subscribe |
| `npm run test:live` | Live mode end to end without an account or network (~70 s): the fake replays the recorded Madrid race, three overlapping relays store it in memory, and the result is checked against the source (no second missing, exact samples, laps in their final version) |

## Environment variables

All are server-only; see [`.env.example`](.env.example).

| Variable | Purpose |
| --- | --- |
| `F1_DATA_MODE` | `openf1` (default) or `fixtures` (recorded sessions only, no network) |
| `OPENF1_API_BASE` | OpenF1 base URL (default `https://api.openf1.org/v1`) |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Store downloaded sessions in Supabase (private `sessions` bucket, `stored_sessions`, `marshal_observations`, `session_calendar` and `download_locks` tables; schema in `supabase/migrations`, apply them in order). Use the project's secret key (`sb_secret_…`); it stays on the server. Without them, sessions are stored on disk. |
| `STORE_DIR` | Disk store location (default `.cache/store`) |
| `STORE_CAP_MB` | Refuse new downloads above this size (default 900) |
| `CRON_SECRET` | Shared secret for the scheduled-download endpoints (`/api/cron/*`), called by the Supabase jobs in `supabase/cron.sql` |
| `OPENF1_USERNAME`, `OPENF1_PASSWORD` | Reserved for live mode (paid OpenF1 tier). Not used yet. |

## How it works

- **Data** comes only from the server. The browser asks the app's API; the server fetches OpenF1 at the free tier's pace (one request every 2.1 s) and stores each session as gzipped JSON in Supabase Storage (or on disk in development): one metadata file (timing, flags, results, the circuit outline) and one file per 15 minutes of car positions and car data. A race is about 5 MB stored. A `stored_sessions` table tracks what is stored, for the size cap and the picker's "downloaded" markers. Car telemetry is kept as files, not rows: about 1.2 million samples a race would fill the free database in a handful of races.
- **New sessions download themselves.** `session_calendar` holds the published schedule (refreshed daily). A Supabase Cron job checks every 15 minutes whether a session has passed its end time plus 3 hours (when OpenF1's data is final) and is not stored; only then does it call `/api/cron/download`, which downloads the whole session on the server. Setup: `supabase/cron.sql`. The picker lists upcoming sessions with their start times.
- **Ingest** of anything else is driven by the browser one step at a time, so each step fits in a Vercel Hobby function (300 s) and progress is visible. The window under the playhead downloads first.
- **Replay** runs in the browser. Everything shown is calculated from the session data at the replay time, so playing, pausing, 1–16× speeds, scrubbing and jumping to a lap or a qualifying phase (forwards or backwards) all stay consistent.
- **Track outline**: the racing line of one fast lap, from OpenF1 car positions, so cars sit on it by construction. Sector boundaries come from that lap's sector times.
- **Marshal sectors**: OpenF1 only gives a flagged sector's number. Where MultiViewer has a circuit file, the server fetches it once and caches it, and the flagged stretch runs from that sector's marker to the next. Elsewhere a stretch is drawn only where stops in at least two other sessions have located it (the `marshal_observations` table, or `data/marshal-sectors/` without Supabase, written by `npm run backtest -- --learn`); otherwise the sector is named but not drawn.
- **Stopped cars**: cars below 30 km/h on the racing line from 30 s before a yellow until 5 s after, having been at racing speed shortly before, excluding the pit lane and the start. A nearby car whose speed fell sharply at that moment is listed as possible contact. Confidence is "high" only once race control names the car in an incident at that time. See `docs/m6-backtest.md` for how well this works.

## Live mode

Needs OpenF1's paid tier. Nothing here costs anything until `OPENF1_USERNAME` / `OPENF1_PASSWORD` are set.

- **Relays.** Supabase Cron calls `/api/live/relay` every minute while a session is on (`live_session_now()`: 20 minutes before the start to 30 after the end). Each call answers at once and, after the response, holds a connection to OpenF1's MQTT feed for 150 s (plain MQTT over TLS on port 8883, as OpenF1 recommends for backends, falling back to MQTT over WebSocket), so two or three relays always overlap and the hand-over never drops data (OpenF1 allows 10 connections). Vercel's 300 s limit is never reached.
- **One copy of everything.** Low-rate topics (laps, race control, positions, intervals, pits, stints, results) are stored one row per record (`live_rows`, keyed by what the row describes; a newer `_id` replaces an older version, e.g. a lap gaining its sector times). Car positions and telemetry are stored one gzipped row per second of session time (`live_buckets`, first write wins), keyed by the samples' own timestamps so every relay builds identical seconds; a relay skips the second it joined in. A relay that finds nobody was connected before it fills the gap (up to 10 minutes) from REST.
- **Browser.** `/live/<session key>` loads the session so far, then polls `/api/live/<key>/updates` and the newest minute of car data every second. The clock shows real time minus a delay and never runs past the newest data; **Sync to video** sets the delay from a moment you press on your stream (NOW, F1 TV), pausing freezes it, and the scrubber goes back over anything received. The OpenF1 token never leaves the server.
- **During a session there is no classification yet**, so retirements and the official result appear once OpenF1 publishes them; the map is drawn on the newest stored session at the circuit.
- **Afterwards** the session is downloaded the normal way about three hours after the end; `live_clear()` removes its live rows.
- **Practice (FP1–FP3)** is followed live like any session (relays start for it), but **never stored**: the calendar marks it `live_only`, so the download job skips it, and its live rows are removed an hour after it ends (`live_clear_finished()`, hourly). Opening a past practice session builds it from OpenF1 on the fly (about 30 s; ~25 requests) and sends it straight to the browser, with nothing written to Supabase; the browser and Vercel's CDN cache what was sent.

**On the day you subscribe:** add the credentials to `.env.local` and Vercel, run `npm run live:check` during a session, and run the `race-tracker-live-relay` job from `supabase/cron.sql` if it is not scheduled yet.

**Testing without an account:** `npm run fake-openf1 -- --lap 10`, then start the app with `OPENF1_API_BASE=http://localhost:4100/v1 OPENF1_MQTT_URL=mqtt://localhost:4101 OPENF1_USERNAME=fake OPENF1_PASSWORD=fake CRON_SECRET=<any>`, call `/api/live/relay?session=11369` with the secret every minute, and open `/live/11369`.

## Data sources

- [OpenF1](https://openf1.org): sessions, drivers, laps, intervals, positions, car location and car data, race control, pit stops and results. Free historical data from 2023, no authentication, 3 requests a second and 30 a minute. Data licensed CC BY-NC-SA 4.0.
- [MultiViewer](https://multiviewer.app) circuit files (linked from OpenF1's `meetings.circuit_info_url`): marshal-sector and corner positions. Hand-made and approximate; no licence is stated; its API's robots.txt disallows crawlers. Fetched once per circuit and year by the server at the owner's request; not stored in the repository.

## Known limitations

- Car positions are approximate (about 4 per second) and show progress around the lap, not left or right placement. The map line is a racing line, not the track edges.
- Some sessions have no position data at all (the 2026 Monaco race); the map then says so.
- Lap data has no deleted-lap flag. Laps are removed using race control's "TIME … DELETED" messages.
- The position feed shows the order on track; penalties applied after the race appear only in the official result, which the race panel lists after the chequered flag.
- Race control sometimes never sends the "clear" for a sector; a flag older than 10 minutes says so instead of being hidden.
- Stopped-car detection is an inference from speed and position, not a steward's report, and never states fault.
- Live mode is not built (it needs OpenF1's paid tier).
- New downloads stop at `STORE_CAP_MB` (default 900 MB) to stay inside Supabase's free 1 GB of storage; there is no automatic eviction.
- Supabase pauses free projects after 7 days without activity; resume it from the dashboard (data is kept).
- The session-download API is unauthenticated; keep a deployment's URL private or add a shared secret.

## Project notes

- [`docs/f1-dashboard-plan.md`](docs/f1-dashboard-plan.md): the plan and milestones
- [`docs/m1-findings.md`](docs/m1-findings.md): data spike findings
- [`docs/m6-backtest.md`](docs/m6-backtest.md): stopped-car backtest
- [`docs/progress.md`](docs/progress.md): what was built, checked and decided at each milestone

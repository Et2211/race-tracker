# Race Tracker

A personal Formula 1 session dashboard. Pick any race, sprint or qualifying session from 2023 onwards and replay it: track map with car positions and the three timing sectors, qualifying sector times by phase, race gaps and splits with a gap trend, and yellow-flag highlighting with an estimate of which cars stopped.

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
| `npm run backfill [-- --standings]` | Write homepage summaries and circuit outlines for sessions stored before they existed (no OpenF1 calls). `--standings` also fetches the championship table after every race and sprint since 2023 (3 OpenF1 requests each; don't run it alongside a download) |

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

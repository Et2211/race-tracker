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

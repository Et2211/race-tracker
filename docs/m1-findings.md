# M1 data spike: findings

Date: 2026-11-14. All evidence comes from the free OpenF1 tier (no credentials) and from the Vercel and Next.js documentation current on this date. Spike code is throwaway and not in the repo; the fixtures it saved are in `fixtures/openf1/`.

## 1. Summary

| Question | Answer | Confidence |
| --- | --- | --- |
| Track outline for every circuit | Feasible from OpenF1 location data alone: one clean lap gives a closed outline within 4–8 m, stable year to year (5 m mean drift). Needs no external circuit data. | High |
| S1/S2/S3 boundaries | Feasible from `laps.date_start` + sector durations, located on the outline within 2–3 m (median) across all drivers. | High |
| Marshal-sector placement for the flag highlight | **Not provided by any data source we can use.** The feed gives a sector number only, and the "mini-sector = marshal sector" idea is wrong (segment colours carry no flag signal). Placement can be *learned* from where cars stop and slow under isolated flags: in Baku qualifying alone, 9 flags anchored 5 of ~21 sectors, repeat observations agreeing within 20–40 m, in monotone order but not equal length. Recommend: always show the sector number as text; highlight a stretch only where learned placement exists, labelled as estimated. | Medium (placement), High (that nothing better is free) |
| Stopped-car detection | Feasible. Across three sessions (Madring race, Baku qualifying, wet Interlagos race) every isolated flag with a stopped or spun car yielded that car, on the racing line, within ±3 s of the flag, and the wet race produced no spurious cars. False positives come from the grid, the pit lane, formation laps and parked cars; all are removable with time and position rules, not a speed threshold. Most "stopped" cars spin and continue, so `dnf` rarely corroborates. Needs the M6 backtest before trusting confidence levels. | Medium–High |
| Jump to lap / qualifying phase | Solved. Lap N start = earliest `laps.date_start` for lap N (matches the `position` leader 57/57). Q1/Q2/Q3 start = `race_control` "SESSION STARTED" with `qualifying_phase` 1/2/3. | High |
| Rate limits and ingest time | One race = ~30 requests, 70 s wall time, ~180 MB raw JSON (1.2 M rows). Zero 429s in 300+ requests at 2.1 s spacing. Location/car_data windows over 30 minutes fail with 422. | High |
| Live relay on Vercel | SSE from a route handler with `Last-Event-ID` resume survives forced cut-offs with 0 duplicates and 0 gaps (local `next start`, 16× replay, 4 cut-offs). Hobby plan allows 300 s per function. Needs shared storage so a resume can land on any instance. | Medium (not yet run on Vercel itself) |
| Data from 2023 | All fields the app depends on exist from 2023 (sector numbers, `qualifying_phase`, `date_start`, `team_colour`, intervals, 3.5 Hz location). | High |
| Gaps | Monaco 2026 race has **4.8 % location coverage** (car_data is complete). Every other 2026 race is complete. The app must say "no position data" for such sessions. | High |

Plan facts that turned out wrong or changed are listed in §13.

## 2. Reference sessions

- **Race: 2026 Spanish Grand Prix, Madring (session 11369, circuit_key 153).** New street circuit (first race 2026), 57 laps, 22 cars. Incidents: a yellow for #44 stopping on track on lap 5, a VSC on laps 14–15 with a double yellow in sector 5 and #18 stopped, a 5-second penalty, and post-race flags. Location and car_data coverage 100 %.
- **Qualifying: same meeting (session 11365).** Full Q1–Q3 with 54 sector flags. Less useful than hoped for marshal-sector work: Q3 had a weather interruption with double yellows in most sectors at once (see §7).
- **Secondary: 2026 Azerbaijan Grand Prix qualifying, Baku (session 11373).** Street circuit, 33 isolated flags in dry running, used for the marshal-sector test (§7).
- **Stress test (owner's suggestion): 2026 São Paulo Grand Prix, Interlagos, mixed weather.** Qualifying (11408) had two red flags, a resumed Q1 and a Q2 that was aborted and never resumed — the awkward cases for jump-to-phase. The race (11412) had 7 yellows and 7 double yellows with full location coverage; see §7.7 for the stopped-car run on it. Wet sessions are poor for *learning* marshal sectors (the whole field slows everywhere) but good for testing that the method stays quiet when it should.

Spot-check circuits used: Spa (long, "Temporary - Road"), Baku (street), Madring (new), Monaco (street, race data missing), Singapore (street), Kuala Lumpur (added mid-2026 as a replacement for Bahrain).

## 3. OpenF1, re-verified against the live docs

Docs: https://openf1.org/docs/ (endpoint reference), https://openf1.org/ (tiers, rate limits, FAQ), https://openf1.org/auth.html (paid tier auth and streaming).

- **Tiers (unchanged):** historical data from 2023 free, no auth, 3 req/s and 30 req/min. Sponsor tier €9.90/month: live data over REST, MQTT (`mqtt.openf1.org:8883`) and WebSocket (`wss://mqtt.openf1.org:8084/mqtt`), 6 req/s and 60 req/min, up to 10 streaming connections. Tokens come from `POST https://api.openf1.org/token` with username/password, expire after 1 hour, and are used as a Bearer header or as the MQTT password. Live = 30 min before to 30 min after a session; "about 3 seconds" behind.
- **Licence:** site footer says data is licensed CC BY-NC-SA 4.0; FAQ says educational, personal, research and non-commercial fan use; credit not required. No F1 marks in the UI (plan already says so).
- **Deprecated fields (removed after 2026):** `drivers.country_code` and `pit.pit_duration` (use `lane_duration`). Nothing else is marked deprecated. `pit.stop_duration` exists from the 2024 US GP and in 2026 may be filled only hours after a session.
- **Endpoints beyond the plan's list:** `overtakes` (races only, "may be incomplete"), `championship_drivers`/`championship_teams` (beta), `weather`. The `location` sample URL in the docs uses date filters with `>`/`<` directly in the query string; `>=`/`<=` also work.
- **Behaviour not in the docs, observed:**
  - Empty results return **HTTP 404** `{"detail":"No results found."}`, not `[]`.
  - Asking for too much returns **HTTP 422** `{"detail":"Failed to retrieve information. You're likely asking for too much data at once."}`. A 30-minute all-car `location` window (150 k rows, 18.6 MB) succeeds in ~7.5 s; a 60-minute one fails. 15-minute windows (~60 k rows, 8 MB, ~2 s) are a safe unit.
  - `location` rows of `(0, 0, 0)` mean "no position" (car in the garage before the session). In the reference race all 2 622 such rows for the leader are before the start; none during the race.
  - `laps.segments_sector_*` values: in flag-free qualifying laps the value `2048` (documented as "yellow sector") is the *majority* value (50–62 % of mini-sectors on six circuits), `2049` green and `2051` purple are rarer, `2064` is pit lane, `0`/`null` missing. `2048` therefore means "no improvement", not a yellow flag. In races the arrays are present but equally uninformative.
  - `starting_grid` is keyed by the **qualifying** session (22 rows for 11365), and returns nothing for the race session key.
  - `session_result` for the reference qualifying has 20 rows for 22 drivers; `duration` and `gap_to_leader` are 3-element arrays [Q1, Q2, Q3] with `0` for the fastest in a phase.
  - `intervals`: one row per car every 3.5 s (median; p90 6.7 s). `gap_to_leader` values seen: number, `null` (leader, 135 rows), `"+1 LAP"`, `"+2 LAPS"`, `"+3 LAPS"`. `interval` is the same shape. `lib/timing/gap.ts` already parses these.
  - `position`: event-based (254 rows for a whole race), not sampled.
  - `laps.date_start` is "approximate" per the docs, but consistent: `date_start(lap N+1) − (date_start(lap N) + lap_duration)` has median 0 ms, p5/p95 ±120 ms over 1 087 laps. 4 of 1 109 laps have no `lap_duration`; 6 have no S1 time.
  - Message text sometimes carries a local-time suffix, e.g. `… NOTED (15:04:12)` for an event at 13:04 UTC in Madrid; `date` is always UTC.

## 4. Rate limits and ingesting a session

Throttle used: one request every 2.1 s (≈28/min, under both limits). Result: **0 × HTTP 429 in 300+ requests**, including bursts of 10 × 8 MB windows. No rate-limit headers are returned, so the client must self-throttle.

| Session | Requests | Wall time | location rows | car_data rows | Raw JSON |
| --- | --- | --- | --- | --- | --- |
| Madring race 11369 (94 min of running, 22 cars) | 32 (10 + 10 windows of 15 min, 12 small endpoints) | 70 s | 610 610 | 604 208 | 182 MB |
| Madring qualifying 11365 | 24 | 57 s | 390 188 | 385 088 | 115 MB |

Everything except `location` and `car_data` is one request per session (`laps` 531 KB, `intervals` 3.8 MB for a race). The per-session cost is dominated by the two high-rate endpoints at ~3.7 Hz × cars.

Implications for the plan's storage requirement (§4 of the plan):
- A race is ~180 MB as raw JSON; stored as compact typed columns (timestamp delta, x/y/z, speed, rpm, gear, throttle, brake, drs) it is roughly 10–20 MB. Vercel Blob is enough for a few dozen cached sessions; pre-ingesting every session from 2023 (≈ 236 race/sprint/qualifying sessions) would be ~3–4 GB compact, which is more than a free Blob store and more than a personal project needs.
- Recommendation: **ingest on demand**, in 15-minute windows, with a progress indicator, caching permanently once complete; optionally pre-ingest a short list of favourites in the background. One race fits comfortably inside a single 300-second function (Hobby limit), but ingestion should still be chunked (one window per invocation or a small loop) so a timeout never leaves a half-written session.
- The time span to ingest must come from the data, not the schedule: `sessions.date_end` is the *scheduled* end. The Monaco 2026 race finished at 15:26:43 after a red flag, 27 minutes after its `date_end` of 15:00; Interlagos 2026 qualifying ran 148 minutes. Use the first `laps.date_start` and the `SESSION FINISHED` race-control message (plus a margin) as the bounds, and keep fetching windows until a window returns no rows.

## 5. Data coverage

Checked for every completed 2026 race, sprint, qualifying and sprint-qualifying session (52 sessions): fraction of the busiest driver's running time covered by location and car_data samples with gaps ≤ 2 s.

- All 24 race/sprint sessions: location ≥ 99.3 %, except **Monte Carlo race (11299): 4.8 %** — a single 10-second slice at 14:00 UTC, while car_data is 100 %. OpenF1 has no location for that race. The track map must show "no position data for this session" rather than an empty map, and the circuit outline for Monaco has to come from another session (qualifying 11295 has 100 %).
- Qualifying sessions: 84–100 %; the shortfall is cars in the garage between runs, not missing data.
- 2023 spot check (Singapore race 9165 and qualifying 9161): all fields present, 20 drivers at 3.5 Hz; `race_control` has `sector`, `qualifying_phase`, `lap_number` and the same message wording.
- Sessions available: 2023: 118 (23 GPs), 2024: 123 (24), 2025: 123 (24), 2026: 24 GPs listed (Bahrain and Saudi Arabia cancelled, a Kuala Lumpur round added in October) plus testing. Every `meetings` row has a `circuit_info_url` pointing at `api.multiviewer.app`.

## 6. Circuit outline

Method: take the fastest clean lap of a session (`lap_duration` set, not a pit-out lap), fetch that driver's `location` rows for `[date_start − 2 s, date_start + lap_duration + 2 s]` (one request, ~380 rows), interpolate the position at the lap's start and end, and join the points. OpenF1 units are decimetres (lap length ÷ 10 matches the published circuit length to within 1–2 %).

| Circuit | Session | Points | Length | Closure gap | Drift vs 2025 race (mean nearest-point) |
| --- | --- | --- | --- | --- | --- |
| Madring (street, new) | 2026 race | 375 | 5 339 m | 0.75 m | n/a (new circuit) |
| Spa | 2026 race | 436 | 6 953 m | 5.4 m | 5.2 m (max 49 m, at a chicane) |
| Baku (street) | 2026 race | 395 | 5 954 m | 4.4 m | 4.4 m (max 20 m) |

| Monaco (street; race has no location) | 2026 qualifying | 271 | 3 273 m | 2.0 m | — |
| Singapore (street) | 2026 race | 358 | 4 858 m | 2.4 m | — |
| Kuala Lumpur (added mid-season) | 2026 race | 366 | 5 502 m | 8.6 m | — |
| Melbourne (street) | 2026 race | 309 | 5 231 m | 8.7 m | — |
| Suzuka | 2026 race | 358 | 5 764 m | 5.0 m | — |

Lengths come out 1–2 % under the published circuit lengths because the racing line cuts corners; the closure gap is the distance between the interpolated start and end points of the lap.

Conclusions:
- The outline is the *racing line of one lap*, not the track edges, which is what the mock draws anyway. Car dots are, by construction, on it.
- Precompute once per `circuit_key` and year from any session with full location coverage, store it with the session cache, and reuse it for every session at that circuit. Re-check when a circuit's `laps` length changes noticeably (layout change).
- External data is not needed for the outline. If it were ever wanted for track edges: `bacinger/f1-circuits` is MIT (GeoJSON, 40 layouts including `es-2026` Madring, 116 points), `TUMFTM/racetrack-database` is LGPL-3.0 (25 tracks, centre line + widths, last updated 2021). Both are in real-world coordinates and would need a similarity transform fitted to the OpenF1 outline; neither has marshal sectors.
- **MultiViewer:** `https://api.multiviewer.app/robots.txt` is `User-agent: * / Disallow: /`, and the site has no visible terms page. I did not fetch any circuit file. FastF1 documents the format (corners, marshal lights, marshal sectors, rotation) but states no licence for the data. This remains an owner decision (§12).

## 7. Timing sectors and marshal sectors

### 7.1 S1/S2/S3 boundaries

For every lap, the car's interpolated position at `date_start`, `date_start + S1`, and `date_start + S1 + S2` was compared across drivers (reference race, 2-minute all-car window, 19–27 laps):

| Boundary | Median spread | p90 | Max |
| --- | --- | --- | --- |
| Start/finish (`date_start`) | 2.5 m | 7.2 m | 8.9 m |
| S1/S2 | 2.3 m | 5.0 m | 6.5 m |
| S2/S3 | 3.0 m | 6.0 m | 7.3 m |

That is within a car length, so the three sectors can be drawn on the outline by taking the median arc position over many laps. The location feed updates at a median 240 ms (p10 160, p90 380, max ~1 000 ms), so interpolation between samples is required.

### 7.2 What the flag feed gives

`race_control` rows with `scope: "Sector"` carry `flag` (YELLOW, DOUBLE YELLOW, CLEAR), `sector` (an integer), `lap_number` in races, `qualifying_phase` in qualifying, and **never** a `driver_number` (0 of 2 056 sector rows across 52 sessions). Sector numbering is per circuit: Madring uses 1–26, Baku 1–21, Spa up to 19 seen, Zandvoort 18, Melbourne 19, Monaco 17. A flag is usually raised in two adjacent sectors at once (the sector of the incident and the one before it, e.g. "YELLOW IN TRACK SECTOR 23" and "… 22" one second apart) and cleared separately.

### 7.3 Mini-sectors are not marshal sectors

The plan's hope that `laps.segments_sector_*` could reveal the marshal sectors does not hold: the "yellow" value `2048` is the default value in flag-free laps (§3), so laps driven under a flag look no different. Tested on six qualifying sessions; P(2048 at index N | flag in sector N active) ranged 13–75 % against a 50–62 % baseline, i.e. noise. The mini-sector count does match the marshal-sector range (Madring 26 mini-sectors, sectors numbered up to 26; Baku 26/21; Monaco 22/17), so the two systems are probably related, but the colour data cannot be used to place them.

### 7.4 Learning placement from car behaviour

Method: project every car's location onto the outline (arc length), compute a reference speed per 25 m bin from flag-free running, and for each isolated flag find the bins where the median speed ratio drops below 75 %, plus any car that stopped (speed < 20 km/h for ≥ 4 samples within 15 m of the line, having been above 100 km/h in the previous 40 s).

Reference race (Madring), isolated flags only:
- Lap 5, "YELLOW IN TRACK SECTOR 23" (and 22): **#44 stopped at 4 730 m of 5 339 m, 0 s before the flag.** 23/26 of the lap length would be 4 720 m.
- Lap 1 (race start), sectors 1 and 2: slowdown at 400–450 m. 2/26 of the lap would be 410 m.
- Laps 14–15 (VSC with a double yellow in sector 5): every sector slows; nothing can be isolated. Flags during a VSC or safety car cannot be placed from speed and must fall back to text.

Two points are consistent with sectors being numbered in lap order and roughly equal in length, which is how circuits are usually divided, but two points are not evidence enough to draw on. The Baku qualifying test (§7.5) adds more.

Madring qualifying was not usable for this: Q3 was interrupted by weather with double yellows in most sectors simultaneously for 3–13 minutes and no car on track, and Q1 had the same pattern at 14:22.

### 7.5 Baku qualifying (street circuit, 33 flags)

Same method on 2026 Azerbaijan qualifying (session 11373; outline 5 971 m, S1/S2 at 2 000 m, S2/S3 at 4 011 m). Flags come as a pair, the incident sector plus the one before it (e.g. "YELLOW IN TRACK SECTOR 9" and "… 8" in the same second), so the table lists the higher number as the incident sector.

| Flag (incident sector) | Time | Evidence | Position along lap | Fraction |
| --- | --- | --- | --- | --- |
| 9 (+8) | Q1 12:07:35 | #18 stopped on the line, 1 s before the flag | 2 488 m | 0.42 |
| 9 (+8) | Q1 12:14:42 | #12 stopped, 3 s after | 2 516 m | 0.42 |
| 5 (+4) | Q1 12:21:45 | #18 stopped, 1 s after | 1 496 m | 0.25 |
| 15 (+14) | Q1 12:22:07 | field slowed to 31 % at 3 725–3 775 m | ~3 750 m | 0.63 |
| 6 (+5) | Q2 12:30:01 | field slowed to 4 % at 1 725–1 775 m | ~1 750 m | 0.29 |
| 15 (+14) | Q2 12:42:36 | #6 stopped, 2 s after | 3 744 m | 0.63 |
| 3 (+2) | Q2 12:43:31 | #31 stopped, 3 s before | 662 m | 0.11 |
| 15 (+14) | Q3 13:00:31 | #43 stopped, 1 s before | 3 729 m | 0.62 |
| 5 (+4) | Q3 13:03:35 | #1 stopped, 3 s after | 1 535 m | 0.26 |

Findings:
- Repeat observations of one sector agree closely: sector 15 three times within 21 m, sector 9 twice within 28 m, sector 5 twice within 39 m. Independent cars, independent flags.
- Ordering is monotone along the lap (3 < 5 < 6 < 9 < 15), so sectors are numbered in driving order and the "a sector runs from its marker to the next" reading is consistent with the data.
- Sectors are **not** equal in length: with 21 sectors, equal division would put sector 15 at 0.67–0.71 of the lap and sector 5 at 0.19–0.24; observed 0.63 and 0.25–0.26. Placement cannot be computed from the sector number alone; it has to be learned per circuit (or taken from circuit data we do not have).
- One qualifying session anchored 5 of Baku's ~21 sectors. Every session at a circuit adds more, and 2023–2026 give four to eight sessions per circuit, so most sectors can be anchored from history; the remainder must stay "position unknown".
- Artefacts the production method must handle: a car that stays parked after an incident poisons the speed statistic for its bin for the rest of the session (exclude cars stationary for more than ~30 s from the field-slowdown statistic); the Baku pit lane runs 11–12 m beside the racing line over 0–200 m and near 5 930 m (lateral-offset and arc-range rules handle it); a car was stationary on the line at 356 m 55 s before a flag (practice start or pit-exit queue), which the timing rule ("slowed before the flag") would list with low confidence.

### 7.7 Interlagos race (mixed weather): does the method stay quiet?

Same method on the 2026 São Paulo race (session 11412; outline 4 236 m, 71 laps, "LOW GRIP CONDITIONS" declared at the start and again on lap 62). Isolated flags, excluding the pre-race practice-start yellows at pit exit:

| Flag | Lap | Stopped car found | Position | Timing vs flag | Afterwards |
| --- | --- | --- | --- | --- | --- |
| DOUBLE YELLOW sector 2 (+1) | 17 | #51 | 336 m (Turn 1) | 1 s before | continued; that lap 92 s vs ~80 s normal |
| DOUBLE YELLOW sector 2 (+1) | 20 | #12 | 323 m (Turn 1) | 1 s after | continued (lap 107 s), finished P5 |
| DOUBLE YELLOW sector 2 (+1) | 61 (2 s long) | none | field slowed to 61 % at 325–375 m | — | — |
| DOUBLE YELLOW sector 15 (+14) | 63 | #44 | 3 645 m | at the flag | continued (laps 116 s and 108 s), finished P9 |

- No spurious cars from the wet field: each flag produced exactly the car that spun, or none.
- The three sector-2 flags place sector 2 at Turn 1 within 15 m of each other; sector 15 sits at 86 % of the lap (Interlagos numbers its sectors up to 15 in this race).
- All three cars **spun and continued**; the race's only retirement (#18, 30 laps) produced no flag. So `session_result.dnf` corroborates only a minority of flag incidents, and the UI wording must be "stopped" / "possibly involved", never "retired", unless `dnf` or a stewards' message confirms it.
- `race_control.lap_number` is the leader's lap; the involved car may be on an earlier lap (#12's 107-second lap is his lap 18 while the flag says lap 20). Incident lookups by driver must use time, not lap number.
- `pit` rows exist for this qualifying (82) but not for the Madrid qualifying (0); availability of the `pit` endpoint in non-race sessions varies, so "in the pit lane" needs the location-based rule as well.

### 7.8 MultiViewer circuit files (fetched once, at the owner's request)

Five `circuit_info_url` files were fetched by hand on 2026-11-14 for inspection only (not stored in the repo): Baku (144), Interlagos (14), Singapore (61) returned data; **Madring (153) and Kuala Lumpur (12) returned 404 "Circuit not found"**. The rest of the calendar was not checked.

- Format: `x`/`y` outline arrays, `corners`, `marshalSectors`, `marshalLights` (each with `number`, `trackPosition {x, y}`, `angle`), `rotation`, plus a `year` field showing when the data was made (2022 for Baku, 2023 for Interlagos and Singapore, although requested for 2026).
- **Same coordinate frame as OpenF1: confirmed.** MultiViewer outline points lie a median 0.1 m (max 1.1 m Baku, 2.8 m Interlagos) from the outline built from OpenF1 location data. No alignment is needed; `rotation` is only a display angle.
- Sector counts match the flag feed: 21 for Baku, 16 for Interlagos. Markers are in lap order (Baku's marker 1 sits 46 m before the start line).
- **"Marker to next marker" holds.** Baku: 8 of 9 learned incident positions fall inside [marker N, marker N+1) for the flagged sector N; the ninth is an estimated slowdown centre 5 m past the boundary. Interlagos: all three sector-2 incidents (323–350 m) fall in [316, 664). The lap-63 incident at 3 645 m falls in sector 14 [3 542, 3 748), and that flag was a *double* yellow in both 14 and 15, so it is consistent too.
- This also gives a rule for flag pairs: the incident is in the sector shown as double yellow (or the higher-numbered one), and the lower-numbered sector is the warning zone before it.
- No licence or terms were found for the data; FastF1 calls it hand-made and "not highly accurate but sufficient for visualization". Coverage of new circuits is missing.

### 7.6 Recommendation

Updated after §7.8: where a MultiViewer file exists, its marshal-sector markers are accurate enough to draw the flagged stretch (marker N to marker N+1), and the learned positions validate it. Where no file exists (Madring, Kuala Lumpur, and any future new circuit), fall back to learned placement, then to text only. Whether the app may use the MultiViewer data at all is an owner decision, because it has no stated licence and its API disallows robots: the options are (a) the app fetches each circuit file once on the server and caches it, (b) the files are saved into the repo by hand, or (c) learned placement only. The original recommendation below still applies to circuits without a file.

- Always show the flagged sector number as text ("Marshal sector 23") — this is exact.
- Keep a per-circuit table of learned sector positions (arc range + number of supporting flags). Highlight a stretch only when the table has an entry with at least two agreeing observations; label it "estimated from past flags". Otherwise, highlight nothing and say "position of sector 23 not known".
- Under VSC/SC, tint the whole track (as the mock does) and list sector flags as text.
- If the owner obtains the MultiViewer circuit file manually and its terms allow, its marshal-sector markers can seed the same table, still validated by the learned data.

## 8. Flag, safety-car and car-event messages

Counts over the 52 completed 2026 race/sprint/qualifying sessions (10 420 rows):

| category / flag / scope | rows | has driver_number | has sector |
| --- | --- | --- | --- |
| Other / – / – | 2 039 | 0 | 0 |
| Flag / BLUE / Driver | 1 322 | all | 0 |
| Flag / CLEAR / Sector | 961 | 0 | all |
| Flag / YELLOW / Sector | 582 | 0 | all |
| Flag / DOUBLE YELLOW / Sector | 513 | 0 | all |
| SessionStatus / – / – | 237 | 0 | 0 |
| Flag / GREEN / Track | 128 | 0 | 0 |
| Flag / CHEQUERED / Track | 112 | 0 | 0 |
| SafetyCar / – / – | 80 | 0 | 0 |
| Flag / CLEAR / Track | 51 | 0 | 0 |
| Flag / BLACK AND WHITE / Driver | 35 | all | 0 |
| Flag / RED / Track | 10 | 0 | 0 |

Real examples (verbatim `message`):
- Sector flags: `YELLOW IN TRACK SECTOR 7`, `DOUBLE YELLOW IN TRACK SECTOR 2`, `CLEAR IN TRACK SECTOR 2`, and the track-wide `TRACK CLEAR`.
- Safety car (`category: "SafetyCar"`, `flag: null`): `SAFETY CAR DEPLOYED`, `SAFETY CAR IN THIS LAP`, `VSC DEPLOYED`, `VSC ENDING`. Related `Other` rows: `SAFETY CAR LIGHTS ON/OFF`, `LAPPED CARS MAY NOW OVERTAKE THE SAFETY CAR: 77`, `MEDICAL CAR DEPLOYED`, `RECOVERY VEHICLE ON TRACK AT TURN 1`, `MARSHALS ON TRACK AT TURN 9`.
- Session status: `SESSION STARTED`, `SESSION ABORTED` (red flag), `SESSION FINISHED`; `RED FLAG`, `RED FLAG - RACE SUSPENDED`, `RACE WILL RESUME AT 17:12` (local time), `Q1 WILL RESUME AT 16:19`, `Q2 WILL NOT BE RESUMED`, `GREEN LIGHT - PIT EXIT OPEN`, `CHEQUERED FLAG`.
- Car events, all in `category: "Other"` with **no `driver_number`**, so cars must be parsed from the text. Patterns: `TURN 11 INCIDENT INVOLVING CAR 16 (LEC) NOTED`, `TURN 1 INCIDENT INVOLVING CARS 55 (SAI) AND 22 (TSU) NOTED - CAUSING A COLLISION (15:04:12)`, `FIA STEWARDS: Q1 INCIDENT INVOLVING CARS 23 (ALB), 31 (OCO), 27 (HUL), 5 (BOR) AND 1 (NOR) NOTED - …`, `FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 55 (SAI)`, `CAR 43 (COL) TIME 1:23.393 DELETED - TRACK LIMITS AT TURN 7 LAP 3 16:02:50`, `BLACK AND WHITE FLAG FOR CAR 44 (HAM) - TRACK LIMITS` (this one has `driver_number`). A regex of `CARS? (\d+) \((\w{3})\)` with `, ` / ` AND ` separators covers all shapes seen.
- Nothing in the feed says "car stopped" or "car retired"; the only retirement evidence is `session_result.dnf` and, sometimes, a later stewards' message. Flags lag incidents: the lap-5 yellow came 0–1 s after #44's speed reached zero, but a flag raised by marshals for debris has no car at all.

Deleted laps: `CAR 43 (COL) TIME 1:23.393 DELETED - TRACK LIMITS AT TURN 7 LAP 3 16:02:50` (517 rows in 2026) and `… LAP DELETED …` (161 rows) do identify deleted laps by car, lap number and time, so the qualifying table can mark deleted laps by parsing these messages. `… WILL BE REINSTATED` also occurs (6 rows).

## 9. Location and car-data timing

- `location` and `car_data` both sample at a median 240 ms (p10 160, p90 380–400, max 1 000 ms) per car, but **on different timestamps** (2 shared out of ~450 in a 2-minute window). Speed at a location sample has to be interpolated from the neighbouring car_data samples, and vice versa.
- Per-car sampling is not synchronised across cars either; a "frame" at replay time T is the interpolation of each car independently.
- `intervals` is roughly every 3.5 s per car; `position` only on change; `weather` every minute.
- All timestamps are UTC with microseconds. Durations are seconds as floats.

## 10. Jump-to-lap and jump-to-phase

- Race lap N starts when the leader crosses the line, which is the earliest `laps.date_start` for lap N. Over the reference race this is monotonic for all 57 laps and agrees with the `position` endpoint's leader 57/57. Lap 1's `date_start` equals the `SESSION STARTED` timestamp for all 22 cars. `race_control.lap_number` agrees with the lap derived this way in 20/22 sector flags (the other two sit within a second of a lap boundary).
- Qualifying: `SESSION STARTED` with `qualifying_phase` 1, 2, 3 (and `GREEN LIGHT - PIT EXIT OPEN` at the same second). After a red flag the phase has `SESSION ABORTED` and a second `SESSION STARTED` with the same phase, so "start of Q2" = the first `SESSION STARTED` with `qualifying_phase = 2`. Interlagos 2026 qualifying is a fixture-worthy example with two red flags.
- The scrubber can therefore map lap ↔ time both ways.

## 11. Live relay on Vercel (replay through the real path)

Test: a throwaway Next.js 16 app with one route handler (`app/api/relay/route.ts`, `maxDuration = 300`) that streams a recorded session (race_control, intervals, location at 1 Hz per car) as server-sent events with `id:` per event and `retry: 500`, honours `Last-Event-ID` on reconnect, and deliberately ends the stream after a configurable number of seconds to simulate the function timeout. Built with `next build`, served with `next start`, driven by a Node client that reconnects exactly as `EventSource` would.

Result (16× replay speed, 15 s cut-offs, 65 s run): 27 468 events, **0 duplicates, 0 gaps**, 4 reconnects of ~505 ms each (the `retry` delay); 16 minutes of session delivered.

What this does and does not show:
- The resume protocol works and the browser can hide the cut-offs. Vercel's documented limits (checked 2026-11-14): Hobby 300 s default and maximum per invocation; Pro 300 s default, 800 s maximum, 1 800 s in beta; WebSockets in public beta but closed at the same limit; the 4.5 MB response cap does not apply to streamed responses. So a browser session is a chain of ≤ 5-minute SSE connections on Hobby.
- The spike kept the recording in one process's memory. On Vercel a reconnect may hit another instance, so the relay must read from shared storage (the same place ingestion writes): the server-side consumer of the OpenF1 stream appends to storage, and SSE handlers only read from it. That also means the live consumer itself cannot be a long-lived function on Hobby; it would have to be polling (within 60 req/min on the paid tier) or an external always-on process. This is an M7 decision and does not block replay.
- Not yet run on Vercel itself; that is a deploy-time check for M7/M8.

Replay in M3 does not need SSE at all: the browser can fetch the cached session in windows and run the clock locally, which also makes scrubbing instant. Recommend that for replay and keep SSE for live only, while sharing the same in-browser event model.

## 12. Decisions needed from the owner

Open questions from the plan, none answerable from the repo:
1. Vercel plan (Hobby or Pro). Hobby's 300 s is enough for on-demand ingestion in windows and for 5-minute SSE hops.
2. Paid storage: Vercel Blob (free tier) covers a few dozen cached sessions; say yes/no to a paid store if we want more.
3. Reference sessions: I chose the 2026 Spanish GP (Madring) race and qualifying, with Baku 2026 qualifying as a second flag-rich session and, on your suggestion, São Paulo 2026 (mixed weather) as a stress case. Say if you prefer others.
4. Storing third-party circuit data in the repo: not needed for the outline. For marshal sectors, the only candidate source is MultiViewer, whose API forbids robots and whose terms I could not find. Options: (a) skip it and rely on learned placement (my recommendation for now), (b) you fetch one circuit file manually in a browser so we can see whether its marshal-sector coordinates even share OpenF1's frame, and decide after reading their terms.

New:
5. Fixture size: the race fixtures are 7 MB (two incident windows of all-car location/car_data). Fine for a personal repo? If not I will trim to one window.

Answers received 2026-11-14: Hobby plan; no paid storage for now; reference sessions accepted; 7.8 MB of fixtures accepted; any session should be selectable and its data downloaded on demand. Consequence for storage: Vercel Blob on Hobby includes 1 GB, 10 GB of transfer and 2 000 upload/list operations a month, and is suspended for 30 days if a limit is exceeded. At 10–20 MB per compacted session that is roughly 50–100 cached sessions, so the cache needs a size cap with least-recently-used eviction, few blobs per session (each upload is one operation), and a visible "storage full" state.

## 13. Corrections to the plan

- The OpenF1 docs page no longer states tiers or rate limits; those are on the homepage and auth page. The numbers match the plan.
- "Mini-sector colours are not available during races": the arrays *are* returned for races, but the colour values are not meaningful in races or qualifying for flag purposes (§3, §7.3).
- "Race-control flag records … in the sample seen, no driver number": confirmed for *all* sector flags (0 of 2 056) and for every `Other` message (0 of 2 039). Only blue and black-and-white flags carry one.
- "Each meeting links to a circuit file hosted by MultiViewer": confirmed, but the host disallows automated access; not used.
- `starting_grid` belongs to the qualifying session key, not the race.
- Empty responses are 404s and oversize windows are 422s; the client must treat both explicitly.
- `location` can be absent for a whole race (Monaco 2026). "All circuits on the calendar must work" is achievable for the outline (use another session at the circuit) but not for car positions in such sessions; the UI must say so.
- The Vercel relay has to read from shared storage, not process memory, because reconnects can land on another instance.

Found later, while building M3–M6 on 31 ingested 2026 sessions:
- A whole race fits in about 5 MB once compacted (not 10–20 MB as estimated in §4); first-time ingest takes 70–90 s.
- Location data is also largely missing for the 2026 Dutch Grand Prix qualifying (positions near 1 of 48 flags) and parts of Belgian qualifying, not only the Monaco race.
- The 2026 Mexico City race's race-control feed contains a "SESSION STARTED" from the previous afternoon.
- `intervals.gap_to_leader` can be `null` for a car that is not leading (São Paulo 2026, P5 at the finish).
- The position feed is the order on track; post-race penalties (São Paulo 2026: LEC +5 s, swapping P7 and P8) appear only in `session_result`.
- The MultiViewer files share OpenF1's frame and "marker to next marker" holds (§7.8); learned positions agree with them in 39 of 40 cases (M6 backtest).

## 14. Fixtures saved

`fixtures/openf1/2026-madrid-race/`, `fixtures/openf1/2026-madrid-qualifying/` and `fixtures/openf1/2026-sao-paulo-qualifying/` (see `fixtures/openf1/README.md`): the small endpoints in full for all three, plus, for the race, all-car `location`/`car_data`/`intervals` for the lap-5 stop (60 s) and the VSC/double-yellow sequence (190 s), and one driver's fastest lap for the outline. The São Paulo qualifying is the red-flag / unresumed-Q2 case for jump-to-phase. Total 7.6 MB.

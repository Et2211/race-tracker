# F1 Race Dashboard: Build Plan

Audience: a coding agent working in an existing Next.js repo. This document says what is needed and in what order, not how to build it. Choose the architecture, libraries, data structures and file layout yourself, follow the repo's existing conventions, and tell the owner about any significant decision.

## 1. Goal

A personal web dashboard for Formula 1 sessions that shows:

1. A **track map** with car positions and the three timing sectors.
2. **Qualifying sector times** for every driver, by qualifying phase (Q1, Q2, Q3).
3. **Race splits**: gaps, intervals and sector times per lap, plus a gap-to-leader trend.
4. **Yellow-flag highlighting**: when a flag is shown, the affected stretch of track is highlighted on the map, and where possible the cars that stopped or were involved are named.
5. A **session picker** with a **Live / Replay** switch. The picker lists past race, sprint and qualifying sessions by season and Grand Prix, from 2023 onwards (as far back as OpenF1 data goes). Replay uses free historical data, so the whole app can be built and used without a paid subscription. Replay must let the user play faster than real time (several speeds), pause, and jump to a chosen lap in a race, or to the start of a qualifying phase (Q1, Q2, Q3) in qualifying.

A visual design mock exists (a Claude Design artifact titled "F1 Race Dashboard"). The owner should export it (screenshot or HTML) into the repo so it can be used as the visual reference. Its data is placeholder only. Match its layout, panels, states and labelling. The mock has a scenario control showing four states: double yellow with a stopped car, yellow with no stopped car found, safety car, and track clear. All four must be supported.

Personal, non-commercial use only. Auth, accounts and payments are out of scope.

## Decisions already made

- Personal, non-commercial use for now. Sharing it later is undecided.
- Hosting is Vercel.
- All circuits on the calendar must work, not just one reference circuit.
- Accuracy matters more than speed of delivery. Where the app cannot be accurate, it should say so on screen and not approximate silently.
- Keep Next.js. Everything else (libraries, rendering approach, storage, state handling, file layout) is the agent's choice.
- The paid OpenF1 tier is undecided, so live mode is the last, optional milestone. Everything else must work in replay.
- Replay includes a past-session menu, faster-than-real-time playback and jump-to-lap.

## 2. Data source: OpenF1

OpenF1 is the only free source found for sector times, positions and race-control messages. It is unofficial and not affiliated with Formula 1. Its terms limit use to educational, personal and non-commercial purposes. Do not use F1 logos or trademarks in the UI.

Facts from its documentation and a sample response (re-verify against the live docs at https://openf1.org/docs/ before relying on them):

- **Free tier:** all historical sessions from 2023, no authentication, 3 requests a second and 30 a minute.
- **Paid tier (EUR 9.90 a month):** live data during sessions over REST, MQTT and WebSocket, 6 requests a second and 60 a minute, up to 10 concurrent streaming connections. Streaming uses an access token as the password. Data counts as live from 30 minutes before a session starts until 30 minutes after it ends, and runs about 3 seconds behind the track.
- **Endpoints needed:** meetings and sessions (pickers), drivers (names, numbers, team colours), laps (sector and lap times), intervals (race gaps), position, location (car coordinates), car_data (speed, throttle, brake, gear), race_control (flags and messages), pit, stints, session_result, starting_grid.
- **Caveats that shape the design:**
  - Location coordinates have an arbitrary origin, are approximate, and show progress around the track, not left or right placement. The API provides no track outline.
  - Race-control flag records carry a sector number (a marshal sector, not S1, S2 or S3) and, in the sample seen, no driver number. Example from the Abu Dhabi 2025 race: "DOUBLE YELLOW IN TRACK SECTOR 14", followed 13 seconds later by "CLEAR IN TRACK SECTOR 14".
  - Nothing in the API says where a marshal sector is on the track.
  - Lap data has no deleted-lap flag, so laps deleted for track limits can look like valid best laps.
  - Mini-sector colours are not available during races. Gap values mix numbers, text such as "+1 LAP", and null for the leader.
  - Final results and the starting grid appear some minutes after the official results.
  - Several fields are deprecated after the 2026 season. Avoid them.
  - Some endpoints may arrive later than "live". This is reported by a third party and is unconfirmed, so test it in a real session.
- Each meeting links to a circuit file hosted by MultiViewer. It might contain the track outline, corners and marshal-sector positions. This was not verified, and automated access to it was refused by the site's robots rules during research. Treat it as unknown. Check its terms and robots policy before using it in the app.

## 3. The hard problems

These decide whether parts of the dashboard are possible. Investigate them first (Milestone 1) and report findings to the owner before building on them.

1. **Track outline and circuit markers.** Other projects solve this in a few ways. FastF1 (a Python library) provides corner positions, marshal-light positions, marshal-sector positions and a rotation angle from circuit data supplied by MultiViewer, and a common approach in FastF1 plotting examples is to draw the track from a car's position trace over a lap. FastF1's documentation says the MultiViewer data was created by hand and is "not highly accurate but sufficient for visualization", and it states no licence. Other possible sources are a GeoJSON collection of circuit layouts on GitHub (bacinger/f1-circuits, MIT licence, about 40 circuits listed, including a 2026 Madrid layout) and a racetrack database with centre lines and widths for 20+ circuits (TUMFTM/racetrack-database). Real-world map coordinates would need aligning to OpenF1's arbitrary coordinate system, whereas an outline built from OpenF1's own location data matches the cars by construction. Recommended starting point: build each circuit's outline from OpenF1 location data over a clean lap, precompute it once per circuit and store it; take corner numbers and marshal-sector markers from the MultiViewer data and match them to the outline by nearest point. The spike must confirm that the marker coordinates share OpenF1's coordinate system, that every circuit on the current calendar is covered, and what the licences and terms allow (including whether the data may be stored in the repo or must be fetched at runtime). Open source projects worth studying for approach, after checking their licences: f1-dash (a Next.js live dashboard), F1ReplayTiming and F1 Race Replay (replay with a track map).
2. **Timing sector boundaries (S1, S2, S3).** Derivable by combining lap start times with sector durations and looking up where the car was at those moments.
3. **Marshal sector placement (needed for the flag highlight).** The OpenF1 API does not provide it. The MultiViewer circuit data does list marshal sectors as numbered positions on the track (positions, not ranges), so a sector probably runs from its marker to the next one. That is an assumption to verify in the spike against real flags and the positions of cars that stopped in them. Where the data is missing or wrong for a circuit, the owner wants accuracy: show the flagged sector number as text and highlight only what can be placed with confidence, and say so on screen. Learning placement from history (where cars stopped during past flags in each sector) is an option for checking or improving the circuit data.
4. **Stopped-car detection.** Calculated by us from car speed and position, as described below. It needs a backtest against past sessions before being trusted.
5. **Live transport on Vercel.** Vercel functions can now accept WebSocket connections (public beta on all plans), but a connection ends when the function reaches its maximum duration (Hobby: 300 seconds; Pro: 300 by default and 800 at most, with a longer beta limit), and each reconnect may land on a different instance. Vercel itself suggests server-sent events when data flows only from server to browser, which is the case here. A workable shape is a server function that holds the OpenF1 stream and relays it to the browser, reconnecting automatically, with a small shared store so a reconnect can resume without gaps. The spike must test this by replaying a past session through it. The access token stays on the server. Polling within OpenF1's 60-requests-a-minute limit is the fallback and supports only a modest update rate. Verify the current Vercel limits and the owner's plan before committing.

### Stopped-car inference (requirements)

- Input: the flag time and marshal sector, plus all cars' speed and position around that time.
- Look back from the flag (starting at around one minute, to be tuned) for cars that stopped or nearly stopped on track. Ignore cars in the pit lane, on the grid, already retired, or finished.
- Use timing: the car that caused or was involved slowed before or at the flag. Cars that slowed after the flag are treated as lifting for the yellow and are not listed.
- Detect possible contact as two cars very close together at the moment of an abrupt speed change.
- Use throttle, RPM and gear where they help distinguish a spin from a stopped car. Use a later retirement in the final results, or a race-control message naming a car, as supporting evidence.
- Output a list of cars with the evidence for each (for example the time it stopped relative to the flag), and a confidence level: none (no stopped car found), medium, or high.
- Never state fault. The wording is always "possibly involved" or "stopped". Fault is the stewards' decision.
- Thresholds must work across circuits (slow corners and pit lanes look slow) and cannot be one global speed.
- Expected limits: location is approximate and updates about 3.7 times a second, flag timing may lag the incident, and yellows with no stopped car (debris, marshals) will correctly produce "none".

## 4. Platform requirements

- Next.js and TypeScript in strict mode, following the repo's existing setup. Check the repo first (framework version, router, package manager, styling, test tooling) and extend it. Do not restructure it without telling the owner.
- All OpenF1 calls happen on the server. The paid-tier token is never sent to the browser or committed to the repo. Provide an example environment file.
- Respect rate limits. Historical data never changes, so cache it permanently and batch requests (for example one location request for all cars over a time window, not one per car).
- Replay data is large. A two-hour race has hundreds of thousands of position and car-data rows, and the free tier allows 30 requests a minute. Opening a session for the first time must not leave the user waiting without feedback. Prefer ingesting sessions into storage ahead of time (a background or scheduled job), with a progress indicator for anything not yet ingested, and choose storage that suits Vercel (its blob or database offerings, or another service). Playback speed and jump-to-lap depend on the data being loaded, so the UI must say when a requested point is not loaded yet.
- Vercel constraints apply: function duration limits, no persistent in-memory state between requests, and connection limits. Design long-running work (ingestion, live relay) around them, and say so if something cannot fit.
- Live and replay should drive the UI through the same internal flow, so the dashboard does not care which one is active. Replay is effectively "live from a recording" and must support play, pause, jump and scrub.
- A mock-data mode with recorded fixtures from real sessions, so the app runs and tests with no network and no subscription.
- Mobile and desktop layouts. The mock is responsive and stacks at phone width.
- Accessibility: tables with proper headers, keyboard-operable controls, sufficient contrast, and meaning never carried by colour alone. Purple and green times need a non-colour cue or a legend.
- Team colours come from the data, not hardcoded.

## 5. Milestones

Each milestone should be working and demonstrable before the next begins. Report to the owner at the gates marked below.

**M0. Repo audit and setup.** Inspect the repo, note its conventions, make sure install, lint, type-check and tests run, and add the environment example and a short README skeleton.
*Done when:* the owner has a short summary of the repo's state and the checks pass.

**M1. Data spike (gate).** Using historical sessions only, write throwaway exploration code and produce a short findings report covering: the circuit outline and marker approach from section 3, tested on several circuits including a street circuit and a recently added one; how to derive S1, S2, S3 boundaries; whether marshal sectors can be placed accurately on the map, and whether the "marker to next marker" assumption holds; real examples of flag, double-yellow, clear, safety car and car-event messages and how they name cars; how consistent the location and car-data timing is; rate-limit behaviour and how long ingesting one full race takes; the Vercel live-relay test; and how to find the start time of a given lap for jump-to-lap (and the equivalent in qualifying). Save a few small real fixtures for later tests. Pick one or two reference sessions with interesting incidents.
*Done when:* the report answers each question with evidence, states what is and isn't feasible, and recommends fallbacks. Owner reviews before M5 starts.

**M2. Static dashboard from the mock.** Build the full layout with fixture data: all panels, all four flag scenarios, qualifying phase tabs, session picker, Live/Replay switch and scrubber (non-functional where data isn't wired yet).
*Done when:* it matches the mock closely at desktop and phone widths and passes basic accessibility checks.

**M3. Historical data layer and replay.** A menu of past sessions (season, then Grand Prix, then session: race, sprint, qualifying and so on) from 2023 onwards; server-side data access with permanent caching and the ingestion approach above; and a replay engine that plays a past session over time. Playback must support pause, several speeds faster than real time (for example 2x to 16x), scrubbing, and jumping to a chosen lap in a race or to the start of Q1, Q2 or Q3 in qualifying.
*Done when:* choosing a past race or qualifying session loads it with clear progress, and play, pause, speed changes, scrubbing and jump-to-lap move the whole dashboard consistently, including when jumping backwards.

**M4. Timing panels.** Qualifying table by phase with computed purple and green, cut lines and ideal lap; race table with gaps, intervals, splits and last lap; gap trend chart. Handle lapped cars, the leader's null gap, and mixed text and number values.
*Done when:* values match the official results for the reference sessions (spot-checked), and unit tests cover the calculations.

**M5. Track map.** Outline, sector colouring, car positions that follow replay time, driver selection linked to the tables.
*Done when:* cars move smoothly around the correct outline on every circuit on the current calendar (spot-check at least a street circuit, a long circuit and a newly added one), including at fast replay speeds.

**M6. Flags and stopped-car inference (gate).** Flag highlight on the map, race-control log, safety car and clear states, and the stopped-car panel with evidence and confidence. Build a backtest that runs the method over many past flags, compares results with known retirements and race-control messages naming cars, and reports how often it is right, wrong or empty.
*Done when:* the backtest report is delivered, thresholds are tuned, and the owner agrees the accuracy is acceptable. If it isn't, the UI wording and confidence levels are adjusted to match, not hidden.

**M7. Live mode (optional, depends on the paid tier).** Requires the paid OpenF1 tier, which the owner hasn't decided on. Build it last. Connect to the live stream through the server-side relay chosen in M1, reconnect cleanly across Vercel's function time limits without losing data, show the delay indicator, and degrade gracefully when the stream drops or a session isn't live.
*Done when:* a real live session (or a faithful simulation, replaying a past one through the same path) runs end to end for a full session length, and the token never appears in browser traffic.
*Notes added 2026-11-15, for features built since:* the dashboard is a pure function of the data up to a moment, so "Worth watching", flags, stopped cars, timing and the gap chart need only the relay to keep that data current. "Sync to video" must work the other way round live: the broadcast (NOW, often 30–60 s behind) lags the data, so pressing Now at lights out should set a delay and the dashboard should show real time minus that delay (never later than the latest data received). The homepage needs a "Watch live" state on the calendar and the countdown card while a session is running; summaries and standings stay final-only.

**M8. Hardening.** Error and empty states for every panel, rate-limit handling, loading states, README (setup, environment variables, data sources, known limitations), and an end-to-end test using fixtures.
*Done when:* the app starts from a clean checkout following the README, and the test suite passes.

## 6. Out of scope for v1

Team radio (coverage dropped sharply in 2026), tyre strategy views, driver comparison tools, accounts, multi-user features, historical data before 2023, and anything commercial.

## 7. Open questions for the owner

1. Which Vercel plan will this run on (Hobby or Pro)? It sets the maximum function duration and affects ingestion and live mode.
2. Is it fine to use a paid storage or database service for cached session data, if Vercel's built-in options aren't enough?
3. Which past sessions should be the first reference sessions? If there's no preference, the agent should choose a recent race with flags and incidents plus its qualifying session, and say what it chose.
4. Is it acceptable to store circuit data from MultiViewer or the GitHub datasets in the repo, once their licences are checked?

# OpenF1 fixtures

Real responses from the free OpenF1 API (https://api.openf1.org/v1), saved on 2026-11-14 for tests and the offline (`F1_DATA_MODE=fixtures`) mode. Each file is the raw JSON array the endpoint returned, filtered to the session and (for the high-rate endpoints) to a short time window. Nothing has been edited or re-shaped.

OpenF1 data is licensed CC BY-NC-SA 4.0 and is for personal, non-commercial use. OpenF1 is not affiliated with Formula 1.

## 2026-madrid-race — Spanish Grand Prix 2026, Race (session 11369, circuit_key 153 "Madring")

Chosen as the reference race: a new street circuit (first used in 2026), with a yellow for a stopped car on lap 5, a VSC with a double yellow on laps 14–15, and 57 laps of clean timing. Location coverage is complete.

| File | Content |
| --- | --- |
| `session.json`, `meeting.json` | The `sessions` and `meetings` rows |
| `drivers.json` | 22 drivers with `team_colour` |
| `laps.json` | All 1109 lap rows (sector durations, `date_start`, mini-sector segments) |
| `race_control.json` | All 185 race-control messages (flags with marshal `sector`, safety-car, stewards) |
| `pit.json`, `stints.json`, `position.json`, `session_result.json`, `weather.json` | Whole session |
| `starting_grid.json` | Empty: the race session key returned no rows (see the M1 report) |
| `overtakes.json` | OpenF1's 123 overtakes (saved 2026-11-22), used only to check the passes the app works out from `position.json` |
| `*.lap5-yellow-s23.json` | `location`, `car_data`, `intervals` for all cars, 13:12:05–13:13:05 UTC. "YELLOW IN TRACK SECTOR 23" at 13:12:24 after #44 stopped at about 4730 m along the lap. |
| `*.lap14-vsc-double-yellow-s5.json` | All cars, 13:26:30–13:29:40 UTC. #18 stops at 13:26:36, "YELLOW IN TRACK SECTOR 22/23" at 13:26:41, "VSC DEPLOYED" 13:27:18, "DOUBLE YELLOW IN TRACK SECTOR 5" 13:27:51, clears 13:28:14–13:29:03, "VSC ENDING" 13:29:21. |
| `*.outline-lap-63-49.json` | Driver 63 only, their lap 49 (the fastest lap of the race, 1:35.587), used to build the track outline. |

## 2026-madrid-qualifying — Spanish Grand Prix 2026, Qualifying (session 11365)

Small endpoints only (no location/car_data windows): `session`, `meeting`, `drivers`, `laps` (312 rows with mini-sector segments), `race_control` (141 rows: Q1–Q3 `SESSION STARTED`/`FINISHED` with `qualifying_phase`, 54 sector flags, deleted-lap messages), `stints`, `position`, `session_result` (20 rows, `duration`/`gap_to_leader` as [Q1, Q2, Q3] arrays), `starting_grid` (22 rows: the grid is keyed by the qualifying session), `weather`. `pit.json` is empty for this session.

## 2026-sao-paulo-qualifying — São Paulo Grand Prix 2026, Qualifying (session 11408)

Mixed weather, chosen as the awkward case for jump-to-phase. Small endpoints only. `race_control.json` (96 rows) has: Q1 `SESSION STARTED` 18:00:00, `SESSION ABORTED` + `RED FLAG` 18:02:23, `Q1 WILL RESUME AT 16:26` (local time), second Q1 `SESSION STARTED` 19:26:00, Q2 aborted at 20:03:17 and `Q2 WILL NOT BE RESUMED`, Q3 started 20:14:00. Also `laps.json` (391 rows), `pit.json` (82 rows — present here although empty for the Madrid qualifying), `position.json` (1 885 rows), `session_result.json` (22 rows), `starting_grid.json` (22 rows), `stints.json`, `weather.json`, `drivers.json`, `session.json`, `meeting.json`.

Times in the files are ISO 8601 UTC with microseconds, as the API sends them.

# Design reference

`Main.dc.html` is the source of the "F1 Race Dashboard" design mock (made in Claude Design). Use it as a text reference for layout, colours, spacing, type and wording. It cannot be opened directly in a browser, because it relies on the Design tool's runtime. All data in it is placeholder data.

## Fonts
Barlow, Barlow Condensed and JetBrains Mono (Google Fonts).

## Colours used in the mock
- Page background `#0E1014`, panels `#161A21`, borders `#262C37`
- Text `#E8EAED`, muted text `#9AA3B2`
- Yellow flag `#FFD60A`, selected driver ring `#E10600`
- Timing colours: purple (fastest in field) `#8E3BFF`, green (personal best) `#2FD07A`
- Sector colours: S1 `#38BDF8`, S2 `#2DD4BF`, S3 `#F472B6`

## States
The `scenario` setting near the bottom of the file (default `double`) switches between four states:
- `double`: double yellow in marshal sector 14, with a "Possibly involved" panel listing stopped cars, evidence and a confidence level.
- `yellow`: single yellow with "No stopped car found" and confidence "none".
- `safety_car`: whole track tinted, safety car banner.
- `clear`: no active flags.

## Other elements
Session picker, Live/Replay toggle with a lap scrubber in replay, Q1/Q2/Q3 tabs with a dashed elimination line, ideal lap, race splits table, gap-to-leader chart, race-control log, phone-width stacking.

## Not real in the mock
- The session picker is visual only, and the scrubber only changes the lap number shown.
- Team colours are hardcoded. They should come from the data.
- Incident details, times and driver names are invented.

## Screenshots
Not added yet. Export one per state and a phone-width view from the design page and put them in this folder (for example `double-yellow.png`).

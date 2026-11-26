import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const loaded = (page: Page) => expect(page.getByText(/Car data (\d+) of \1 parts loaded/)).toBeVisible({ timeout: 20_000 });

test("home shows the season calendar, opens a race from it and links back", async ({ page }) => {
  await page.goto("/?season=2026"); // a fixed season: the default is the current year
  await expect(page.getByRole("heading", { name: "2026 calendar" })).toBeVisible();
  await page.getByRole("link", { name: "Watch the race: Spanish Grand Prix" }).click();
  await expect(page).toHaveURL(/\/session\/11369$/);
  await expect(page.getByRole("heading", { name: "Spanish Grand Prix" })).toBeVisible();
  await page.getByRole("link", { name: "← All sessions" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /^\d{4} calendar$/ })).toBeVisible(); // the current season, whatever year it is
});

test("home has no detectable accessibility violations and fits the screen", async ({ page }) => {
  await page.goto("/?season=2026"); // a fixed season: the default is the current year
  await expect(page.getByRole("heading", { name: "2026 calendar" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw).toBeLessThanOrEqual(cw);
});

test("worth watching names the close pair and selects the chasing car", async ({ page }) => {
  // Lap 30 of the 2026 Madrid race: Lindblad (#41) 1.3 s behind Colapinto (#43) for P10.
  await page.goto("/session/11369?t=2026-09-13T13:53:01Z");
  await loaded(page);
  const panel = page.getByRole("region", { name: "Worth watching" });
  const row = panel.getByRole("button", { name: /#41 on .*#43 for P10/ });
  await expect(row).toBeVisible();
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByRole("link", { name: /Open F1 TV/ })).toHaveAttribute("target", "_blank");
});

test("race replay shows the lap-5 yellow, the stopped car and the race-control log", async ({ page }) => {
  await page.goto("/session/11369?t=2026-09-13T13:12:27Z");
  await loaded(page);
  const panel = page.getByRole("region", { name: "YELLOW flag in marshal sector 23" });
  await expect(panel.getByText("Marshal sector 23", { exact: true })).toBeVisible();
  await expect(panel.getByText("#44 HAM")).toBeVisible();
  await expect(panel.getByText("STOPPED FIRST")).toBeVisible();
  // Madrid has no MultiViewer markers, and its only learned positions come from this same race, which
  // are left out, so the sector is named but not drawn.
  await expect(panel.getByText("Not shown on the map.")).toBeVisible();
  await expect(page.getByText("YELLOW IN TRACK SECTOR 23").first()).toBeVisible();
  await expect(page.getByRole("table", { name: /Race order/ }).getByRole("row")).toHaveCount(23);
});

test("play, speed, jump forwards and backwards keep the dashboard consistent", async ({ page }) => {
  await page.goto("/session/11369?t=2026-09-13T13:12:27Z");
  await loaded(page);
  const label = page.locator(".clock-label");
  await expect(label).toContainText("Replay lap 6");

  await page.getByRole("button", { name: "16×", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(label).not.toContainText("13:12:27"); // time moves on
  await page.getByRole("button", { name: "Pause", exact: true }).click();

  await page.getByLabel("Jump to").selectOption({ label: "Lap 40" });
  await expect(label).toContainText("Replay lap 40");
  await expect(page.getByText("Lap 40 / 57")).toBeVisible();
  // No telemetry is recorded there in fixture mode, and the page says so.
  await expect(page.getByText("No car positions were recorded for this moment.")).toBeVisible();

  await page.getByLabel("Jump to").selectOption({ label: "Lap 2" });
  await expect(label).toContainText("Replay lap 2");
  await expect(page.getByText("Lap 2 / 57")).toBeVisible();
  await expect(page.getByText("Track clear").first()).toBeVisible();
});

test("qualifying replay jumps to phases and shows the red flag", async ({ page }) => {
  await page.goto("/session/11408");
  await expect(page.getByRole("heading", { name: "São Paulo Grand Prix" })).toBeVisible();
  const phases = page.getByRole("group", { name: "Jump to a phase" });
  await phases.getByRole("button", { name: "Q1" }).click();
  await expect(page.getByRole("timer")).toContainText("Q1 starts in 0:10"); // lands 10 s before the start
  // 2:23 into Q1 the session was red-flagged: the clock stops with 15:37.4 left, shown rounded up.
  await page.goto("/session/11408?t=2026-11-07T18:02:40Z");
  await expect(page.getByText("Red flag · session stopped")).toBeVisible();
  await expect(page.getByRole("timer")).toContainText("Q1 · clock stopped · 15:38 left");
  await phases.getByRole("button", { name: "Q2" }).click();
  await expect(phases.getByRole("button", { name: "Q2" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("timer")).toContainText("Q2 starts in 0:10");
  await expect(page.getByRole("checkbox", { name: "Skip breaks" })).toBeChecked();
});

test("the dashboard has no detectable accessibility violations", async ({ page }) => {
  await page.goto("/session/11412?t=2026-11-08T17:28:05Z");
  await loaded(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test("the page fits the screen without sideways scrolling", async ({ page }) => {
  await page.goto("/session/11369?t=2026-09-13T13:27:30Z");
  await loaded(page);
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw).toBeLessThanOrEqual(cw);
});

test("clicking a driver selects it; clicking elsewhere or pressing Escape clears it", async ({ page }) => {
  await page.goto("/session/11369?t=2026-09-13T13:12:27Z");
  await loaded(page);
  const ham = page.getByRole("table", { name: /Race order/ }).getByRole("button", { name: /^HAM/ });
  await ham.click();
  await expect(ham).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("#44 HAM · Hamilton")).toBeVisible();
  // The same car on the map is the same selection: clicking it clears, clicking again selects.
  await page.locator('svg.map [data-driver="44"]').click();
  await expect(ham).toHaveAttribute("aria-pressed", "false");
  await page.locator('svg.map [data-driver="44"]').click();
  await expect(ham).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("heading", { name: "Track map" }).click();
  await expect(ham).toHaveAttribute("aria-pressed", "false");
  await ham.click();
  await page.keyboard.press("Escape");
  await expect(ham).toHaveAttribute("aria-pressed", "false");
});

/** Animations currently running on rows of the table whose name matches. */
const rowAnimations = (page: Page, table: string) =>
  page.evaluate((name) => document.getAnimations().filter((a) => {
    const el = (a.effect as KeyframeEffect | null)?.target;
    return el instanceof HTMLTableRowElement && el.closest("table")?.querySelector("caption")?.textContent?.includes(name);
  }).length, table);

test("race rows slide when positions change during playback, and snap on a jump", async ({ page }) => {
  // Hamilton spins at 13:12:24 and drops from 5th to 10th within six seconds.
  await page.goto("/session/11369?t=2026-09-13T13:12:20Z");
  await loaded(page);
  await page.getByRole("button", { name: "2×", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => rowAnimations(page, "Race order"), { timeout: 10_000, intervals: [50] }).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();

  await expect.poll(() => rowAnimations(page, "Race order")).toBe(0); // the slide has finished
  await page.getByLabel("Jump to").selectOption({ label: "Lap 30" });
  await expect(page.locator(".clock-label")).toContainText("Replay lap 30");
  expect(await rowAnimations(page, "Race order")).toBe(0);
});

test("qualifying rows slide when a new best lap changes the order", async ({ page }) => {
  await page.goto("/session/11408?t=2026-11-07T19:30:00Z");
  await expect(page.getByRole("heading", { name: "São Paulo Grand Prix" })).toBeVisible();
  await page.getByRole("button", { name: "16×", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => rowAnimations(page, "Qualifying sector times"), { timeout: 15_000, intervals: [50] }).toBeGreaterThan(0);
});

test("rows do not animate when the system asks for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/session/11369?t=2026-09-13T13:12:20Z");
  await loaded(page);
  await page.getByRole("button", { name: "2×", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  let seen = 0;
  for (let i = 0; i < 40; i++) {
    seen += await rowAnimations(page, "Race order");
    await page.waitForTimeout(100);
  }
  await expect(page.locator(".clock-label")).not.toContainText("13:12:20");
  expect(seen).toBe(0);
});

test("sync to video jumps to lights out, plays at normal speed and ends when the replay is moved", async ({ page }) => {
  await page.goto("/session/11369");
  await expect(page.getByRole("heading", { name: "Spanish Grand Prix" })).toBeVisible();
  await page.getByText("Sync to video").click();
  await expect(page.getByLabel("Moment")).toHaveValue("lights-out");
  await page.getByRole("button", { name: "Now", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Synced at lights out." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Playback speed" }).getByRole("button", { name: "1×" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".clock-label")).toContainText("Replay lap 1");
  await page.getByRole("button", { name: "+5 s" }).click();
  await expect(page.getByText("Synced to video")).toBeVisible();
  await page.getByRole("group", { name: "Playback speed" }).getByRole("button", { name: "4×" }).click();
  await expect(page.getByText("Sync to video", { exact: true })).toBeVisible();
});

test("worth watching marks a car on fresher tyres catching one still to stop as strategy", async ({ page }) => {
  // Lap 35 of the 2026 Madrid race: #63 is 1.1 s behind #30 on tyres 28 laps fresher; #30 has not stopped.
  await page.goto("/session/11369?t=2026-09-13T14:01:37Z");
  await loaded(page);
  const row = page.getByRole("region", { name: "Worth watching" }).getByRole("button", { name: /#63 on .*#30 for P/ });
  await expect(row).toContainText("Strategy");
  await expect(row).toContainText("Not a straight fight");
  await expect(row).toContainText("has not stopped yet");
});

test("retired cars leave the map once they have stopped", async ({ page }) => {
  // #44 retired on lap 7 and sits in the garage; #18 crawls to a halt on track at about 13:26:50 during the lap-14 VSC.
  await page.goto("/session/11369?t=2026-09-13T13:26:46Z");
  await loaded(page);
  await expect(page.locator('svg.map [data-driver="44"]')).toHaveCount(0);
  await expect(page.locator('svg.map [data-driver="18"]')).toHaveCount(1);
  await page.goto("/session/11369?t=2026-09-13T13:27:30Z");
  await loaded(page);
  await expect(page.locator('svg.map [data-driver="18"]')).toHaveCount(0);
  await expect(page.locator('svg.map [data-driver="63"]')).toHaveCount(1);
});

test("race control keeps every message so far and scrolls", async ({ page }) => {
  await page.goto("/session/11369?t=2026-09-13T14:30:00Z");
  await loaded(page);
  const log = page.getByRole("list", { name: "Race control" });
  expect(await log.getByRole("listitem").count()).toBeGreaterThan(20);
  const { scrolls } = await log.evaluate((el) => ({ scrolls: el.scrollHeight > el.clientHeight }));
  expect(scrolls).toBe(true);
  // The oldest message is at the bottom of the list, reachable by scrolling.
  await log.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const oldest = log.getByRole("listitem").last();
  await expect(oldest).toContainText("GREEN LIGHT - PIT EXIT OPEN");
  await expect(oldest).toContainText("12:20:01"); // its time, UTC
  const inside = await log.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const item = el.lastElementChild!.getBoundingClientRect();
    return item.top >= box.top - 1 && item.bottom <= box.bottom + 1;
  });
  expect(inside).toBe(true);
});

test("the live page says live data is not set up when the server has no OpenF1 account", async ({ page }) => {
  await page.goto("/live/11369");
  await expect(page.getByRole("heading", { name: "Could not connect to the live session" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Live timing isn't available" })).toBeVisible();
  // A replay of a session that is not on now offers no live view.
  await page.goto("/session/11369");
  await expect(page.getByRole("heading", { name: "Spanish Grand Prix" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Watch live" })).toHaveCount(0);
});

test("a part that fails for a moment is fetched again by itself", async ({ page }) => {
  let failed = 0;
  // The first request for each telemetry part gets "busy, try again in 1 s"; later ones go through.
  await page.route(/\/api\/sessions\/11369\/chunks\/\d+/, async (route) => {
    if (failed < 2) {
      failed++;
      return route.fulfill({ status: 503, headers: { "retry-after": "1" }, contentType: "application/json", body: JSON.stringify({ error: "Busy", code: "busy" }) });
    }
    return route.continue();
  });
  await page.goto("/session/11369");
  await loaded(page);
  expect(failed).toBe(2);
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
});

test("driver focus shows the selected driver's race so far", async ({ page }) => {
  // Lap 6 of the 2026 Spanish GP: #12 started second and has not stopped yet.
  await page.goto("/session/11369?t=2026-09-13T13:12:27Z");
  await loaded(page);
  const panel = page.getByRole("region", { name: "Driver focus" });
  await expect(panel.getByText("Pick a driver on the map or in a timing table")).toBeVisible();
  await page.getByRole("table", { name: /Race order/ }).locator('[data-driver="12"]').first().click();
  await expect(panel.getByText("#12 ANT")).toBeVisible();
  await expect(panel.getByText("Started P2")).toBeVisible();
  await expect(panel.getByText("No stops yet.")).toBeVisible();
  // Clicking inside the panel keeps the driver selected.
  await panel.getByText("Places gained and lost", { exact: true }).click();
  await expect(panel.getByText("#12 ANT")).toBeVisible();
  const results = await new AxeBuilder({ page }).include("#driver-focus").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  // Race pace: #12 against the car ahead, #1.
  await panel.getByRole("button", { name: "Race pace" }).click();
  await expect(panel.getByLabel("Compare with")).toHaveValue("1");
  await expect(panel.getByRole("table", { name: "ANT stints" })).toContainText("Mediums");
  const pace = await new AxeBuilder({ page }).include("#driver-focus").analyze();
  expect(pace.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  // Gaps: lap by lap at the line, as a table too.
  await panel.getByRole("button", { name: "Gaps" }).click();
  await panel.getByText("Gaps as a table").click();
  await expect(panel.getByRole("region", { name: "Gaps lap by lap" }).getByRole("row").nth(1)).toContainText("P");
  const gaps = await new AxeBuilder({ page }).include("#driver-focus").analyze();
  expect(gaps.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  // Lap comparison: #12's best lap so far against the fastest by anyone else. The fixtures only
  // record car data around two incidents, so the page says this lap has none.
  await panel.getByRole("button", { name: "Lap comparison" }).click();
  await expect(panel.getByLabel("ANT lap")).toBeVisible();
  await expect(panel.getByRole("table", { name: "Lap comparison by sector" })).toContainText("Sector 3");
  await expect(panel.getByText(/No car data was recorded for this lap/).first()).toBeVisible();
  const laps = await new AxeBuilder({ page }).include("#driver-focus").analyze();
  expect(laps.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  // Corners: the same two laps, so the same message.
  await panel.getByRole("button", { name: "Corners" }).click();
  await expect(panel.getByLabel("ANT lap")).toBeVisible();
  await expect(panel.getByText(/No car data was recorded for this lap/).first()).toBeVisible();
  const corners = await new AxeBuilder({ page }).include("#driver-focus").analyze();
  expect(corners.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test("a chart can be read by tapping it on a phone, without selecting text", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "needs a touch screen");
  await page.goto("/session/11369?t=2026-09-13T13:12:27Z");
  await loaded(page);
  const panel = page.getByRole("region", { name: "Driver focus" });
  await page.getByRole("table", { name: /Race order/ }).locator('[data-driver="12"]').first().click();
  await panel.getByRole("button", { name: "Race pace" }).click();

  const chart = panel.locator(".chart-wrap");
  await expect(chart).toHaveCSS("user-select", "none");
  const area = (await chart.locator(".chart-hit").boundingBox())!;
  const x = area.x + area.width / 2;
  await page.touchscreen.tap(x, area.y + area.height / 2);

  // The point stays up after the finger lifts, and the tooltip sits over the line it describes
  // (the chart is wider than the screen, so its tooltip is placed against the chart, not the screen).
  const tooltip = chart.locator(".tooltip");
  await expect(tooltip).toBeVisible();
  const box = (await tooltip.boundingBox())!;
  const line = (await chart.locator("svg line[stroke-dasharray='3 3']").last().boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - line.x)).toBeLessThan(2);
  expect(await page.evaluate(() => String(getSelection()))).toBe("");

  // Touching anywhere else puts it away.
  await page.touchscreen.tap(4, 300);
  await expect(tooltip).toHaveCount(0);
});

test("sessions the app does not list are refused without a download, and crawlers are kept off the API", async ({ request }) => {
  for (const path of ["/api/sessions/1234567/meta", "/api/sessions/1234567/chunks/0", "/api/sessions/1234567/corners"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(404);
    expect((await res.json()).code, path).toBe("unknown");
    expect(res.headers()["cache-control"], path).toContain("s-maxage=300");
  }
  // A listed session still opens.
  expect((await request.get("/api/sessions/11369/meta")).status()).toBe(200);
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /api/");
});

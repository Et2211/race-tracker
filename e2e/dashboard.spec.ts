import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const loaded = (page: Page) => expect(page.getByText(/Car data (\d+) of \1 parts loaded/)).toBeVisible({ timeout: 20_000 });

test("home shows the season calendar, opens a race from it and links back", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "2026 calendar" })).toBeVisible();
  await page.getByRole("link", { name: "Watch the race: Spanish Grand Prix" }).click();
  await expect(page).toHaveURL(/\/session\/11369$/);
  await expect(page.getByRole("heading", { name: "Spanish Grand Prix" })).toBeVisible();
  await page.getByRole("link", { name: "← All sessions" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "2026 calendar" })).toBeVisible();
});

test("home has no detectable accessibility violations and fits the screen", async ({ page }) => {
  await page.goto("/");
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
  await expect(panel.getByText(/has not been located on this circuit yet/)).toBeVisible();
  await expect(page.getByText("YELLOW IN TRACK SECTOR 23").first()).toBeVisible();
  await expect(page.getByRole("table", { name: /Race order/ }).getByRole("row")).toHaveCount(23);
});

test("play, speed, jump forwards and backwards keep the dashboard consistent", async ({ page }) => {
  await page.goto("/session/11369?t=2026-09-13T13:12:27Z");
  await loaded(page);
  const label = page.locator("label[for=scrub]");
  await expect(label).toContainText("Replay lap 6");

  await page.getByRole("button", { name: "16×", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(label).not.toContainText("13:12:27");

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
  await page.getByLabel("Jump to").selectOption({ label: "Q1" });
  const slider = page.getByRole("slider");
  // Two and a half minutes into Q1 the session was red-flagged.
  await slider.focus();
  for (let i = 0; i < 150; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Red flag · session stopped")).toBeVisible();
  await page.getByLabel("Jump to").selectOption({ label: "Q2" });
  await expect(page.locator("label[for=scrub]")).toContainText("Q2");
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

  await page.waitForTimeout(600);
  await page.getByLabel("Jump to").selectOption({ label: "Lap 30" });
  await expect(page.locator("label[for=scrub]")).toContainText("Replay lap 30");
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
  await expect(page.locator("label[for=scrub]")).not.toContainText("13:12:20");
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
  await expect(page.locator("label[for=scrub]")).toContainText("Replay lap 1");
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

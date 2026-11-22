import { describe, expect, it } from "vitest";
import type { Lap, LocationRow } from "@/lib/openf1/types";
import { outlineFrom } from "@/lib/session/assemble";
import { fixture, raceControl, telemetryFor } from "@/test/fixtures";
import { bestOption, deltaTrace, lapOptions, officialOf, valueAt } from "./lap-compare";
import { lapTrace, timeAtDistance, type LapTrace } from "./lap-trace";

// 2026 Spanish GP race. The fixtures hold one full lap of car data: #63's lap 49, the race's fastest.
const slug = "2026-madrid-race";
const laps = fixture<Lap[]>(slug, "laps");
const rc = raceControl(slug);
const lap49 = laps.find((l) => l.driver_number === 63 && l.lap_number === 49)!;
const outline = outlineFrom(lap49, fixture<LocationRow[]>(slug, "location.outline-lap-63-49"))!;
const start = Date.parse(lap49.date_start!);
const telemetry = telemetryFor(slug, [{ name: "outline-lap-63-49", from: new Date(start - 10_000).toISOString(), to: new Date(start + 110_000).toISOString() }]);
const options = lapOptions(laps, rc, Date.parse("2026-09-13T15:00:00Z"));
const option49 = options.find((o) => o.driver === 63 && o.lap === 49)!;
const traced = lapTrace(outline, telemetry.traces.get(63)!, telemetry.cars.get(63)!, 63, 49, start, officialOf(option49)) as LapTrace;

describe("lap trace", () => {
  it("places a whole lap along the outline, pinned to the official times", () => {
    expect("error" in traced).toBe(false);
    expect(traced.duration).toBe(lap49.lap_duration! * 1000);
    expect(timeAtDistance(traced, traced.length)).toBeCloseTo(lap49.lap_duration! * 1000, -2);
    expect(Math.abs(timeAtDistance(traced, outline.s1 / 10) - lap49.duration_sector_1! * 1000)).toBeLessThan(100);
    expect(traced.length).toBeCloseTo(outline.length / 10, 6);
    expect(traced.d.at(-1)!).toBeGreaterThan(traced.length - 30);
    for (let i = 1; i < traced.d.length; i++) expect(traced.d[i]).toBeGreaterThanOrEqual(traced.d[i - 1]);
    expect(Math.max(...traced.speed)).toBeGreaterThan(300);
  });

  it("refuses a lap whose car data isn't there", () => {
    const lap10 = options.find((o) => o.driver === 63 && o.lap === 10)!;
    expect(lapTrace(outline, telemetry.traces.get(63)!, telemetry.cars.get(63)!, 63, 10, lap10.start, officialOf(lap10))).toHaveProperty("error");
  });
});

describe("lap comparison", () => {
  it("shows no gap between a lap and itself, and the right gap to a slower copy", () => {
    expect(deltaTrace(traced, traced).delta.every((v) => Math.abs(v) < 1e-9)).toBe(true);
    // The same lap 1 % slower everywhere: 1 % of the lap time behind at the line.
    const slower: LapTrace = { ...traced, duration: traced.duration * 1.01, t: traced.t.map((x) => x * 1.01) };
    const { delta } = deltaTrace(traced, slower);
    expect(delta.at(-1)!).toBeCloseTo((traced.duration * 0.01) / 1000, 1);
    expect(delta.every((v, i) => i === 0 || v >= delta[i - 1] - 1e-9)).toBe(true);
  });

  it("reads channels by distance", () => {
    expect(valueAt(traced, "speed", 0)).toBe(traced.speed[0]);
    expect([0, 1]).toContain(valueAt(traced, "brake", 1000));
    expect(valueAt(traced, "gear", 2500)).toBeGreaterThanOrEqual(1);
  });

  it("lists laps with deleted and pit laps marked, and picks a clean best", () => {
    const mine = options.filter((o) => o.driver === 12);
    expect(mine.filter((o) => o.deleted).map((o) => o.lap)).toEqual([6, 23]);
    expect(mine.find((o) => o.lap === 1)!.note).toBe("first");
    expect(mine.find((o) => o.lap === 14)!.note).toBe("in");
    expect(mine.find((o) => o.lap === 15)!.note).toBe("out");
    const best = bestOption(options, 12)!;
    expect(best.deleted || best.note).toBeFalsy();
    expect(mine.filter((o) => !o.deleted && !o.note).every((o) => o.time >= best.time)).toBe(true);
    // The fastest lap of the race: #63's lap 49.
    expect(bestOption(options)).toMatchObject({ driver: 63, lap: 49 });
  });

  it("only lists laps finished by the replay time", () => {
    const t = Date.parse("2026-09-13T13:30:00Z");
    expect(lapOptions(laps, rc, t).every((o) => o.start + o.time * 1000 <= t)).toBe(true);
  });
});

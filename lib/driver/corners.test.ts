import { describe, expect, it } from "vitest";
import type { Lap, LocationRow } from "@/lib/openf1/types";
import { outlineFrom } from "@/lib/session/assemble";
import { pointAt } from "@/lib/track/geometry";
import { fixture, raceControl, telemetryFor } from "@/test/fixtures";
import { compareCorners, cornersFromMultiViewer, cornersFromSpeed, cornerZones } from "./corners";
import { lapOptions, officialOf } from "./lap-compare";
import { lapTrace, type LapTrace } from "./lap-trace";

// #63's lap 49 of the 2026 Spanish GP, the one full lap of car data in the fixtures.
const slug = "2026-madrid-race";
const laps = fixture<Lap[]>(slug, "laps");
const lap49 = laps.find((l) => l.driver_number === 63 && l.lap_number === 49)!;
const outline = outlineFrom(lap49, fixture<LocationRow[]>(slug, "location.outline-lap-63-49"))!;
const start = Date.parse(lap49.date_start!);
const telemetry = telemetryFor(slug, [{ name: "outline-lap-63-49", from: new Date(start - 10_000).toISOString(), to: new Date(start + 110_000).toISOString() }]);
const option = lapOptions(laps, raceControl(slug), Date.parse("2026-09-13T15:00:00Z")).find((o) => o.driver === 63 && o.lap === 49)!;
const lap = lapTrace(outline, telemetry.traces.get(63)!, telemetry.cars.get(63)!, 63, 49, start, officialOf(option)) as LapTrace;

/** A point on the outline `m` metres from the line, nudged `off` metres sideways. */
const at = (m: number, off = 0) => {
  const p = pointAt(outline, m * 10);
  return { x: p.x - p.ty * off * 10, y: p.y + p.tx * off * 10 };
};

describe("corners from a circuit file", () => {
  it("places numbered turns along the lap", () => {
    const corners = cornersFromMultiViewer(outline, [
      { number: 2, ...at(1200, 2) },
      { number: 1, ...at(400) },
      { number: 3, ...at(3000, -5) },
    ]);
    expect(corners!.map((c) => c.label)).toEqual(["T1", "T2", "T3"]);
    expect(corners![1].d).toBeCloseTo(1200, -1);
  });

  it("refuses a file that doesn't fit the track", () => {
    // One turn 60 m off the line: the layout has changed since the file was drawn.
    expect(cornersFromMultiViewer(outline, [{ number: 1, ...at(400) }, { number: 2, ...at(1200, 60) }, { number: 3, ...at(3000) }])).toBeNull();
    // Turns out of lap order.
    expect(cornersFromMultiViewer(outline, [{ number: 1, ...at(3000) }, { number: 2, ...at(400) }, { number: 3, ...at(4000) }, { number: 4, ...at(1000) }])).toBeNull();
  });
});

describe("corners from the speed trace", () => {
  it("finds the braking corners of a real lap, in order", () => {
    const corners = cornersFromSpeed(lap);
    // Madring has nine places where cars slow by 25 km/h or more.
    expect(corners.length).toBe(9);
    expect(corners.map((c) => c.label)).toEqual(corners.map((_, i) => `C${i + 1}`));
    for (let i = 1; i < corners.length; i++) expect(corners[i].d).toBeGreaterThan(corners[i - 1].d);
  });
});

describe("corner by corner", () => {
  const corners = cornersFromSpeed(lap);

  it("gives zero gain for a lap against itself, with sensible figures", () => {
    const rows = compareCorners(corners, lap, lap);
    for (const r of rows) {
      expect(r.gain).toBeCloseTo(0, 9);
      expect(r.a.slowest).toBeLessThan(300);
      if (r.a.brakeBefore !== null) expect(r.a.brakeBefore).toBeGreaterThanOrEqual(0);
      if (r.a.exit !== null) expect(r.a.exit).toBeGreaterThan(r.a.slowest);
    }
  });

  it("splits a uniformly slower lap's loss across the corners in proportion to their time", () => {
    const slower: LapTrace = { ...lap, duration: lap.duration * 1.01, t: lap.t.map((x) => x * 1.01) };
    const rows = compareCorners(corners, lap, slower);
    for (const r of rows) expect(r.gain!).toBeCloseTo((r.a.time * 0.01) / 1000, 3);
  });

  it("keeps each corner's stretch between its neighbours", () => {
    const zones = cornerZones(corners, lap.length);
    zones.forEach((z, i) => {
      expect(z.from).toBeLessThanOrEqual(corners[i].d);
      expect(z.to).toBeGreaterThanOrEqual(corners[i].d);
      if (i > 0) expect(z.from).toBeGreaterThanOrEqual(zones[i - 1].to - 1e-9);
    });
  });
});

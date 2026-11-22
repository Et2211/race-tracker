import { describe, expect, it } from "vitest";
import type { Lap, PitRow, PositionRow, SessionResult, Stint } from "@/lib/openf1/types";
import { fixture, raceControl, telemetryFor } from "@/test/fixtures";
import { isRetiredAt, retirements } from "@/lib/incident/retired";
import { floorIndex } from "@/lib/session/telemetry";

import { labelRetirements, passes } from "./passes";
import { carsNamed, driverSummary, type SummaryInput } from "./summary";

// 2026 Spanish GP race: full position, pit, stint and result feeds.
const slug = "2026-madrid-race";
const rc = raceControl(slug);
const positions = fixture<PositionRow[]>(slug, "position").sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
const laps = fixture<Lap[]>(slug, "laps");
const pits = fixture<PitRow[]>(slug, "pit");
const results = fixture<SessionResult[]>(slug, "session_result");
const stints = fixture<Stint[]>(slug, "stints");
const start = Date.parse(rc.find((r) => r.message === "SESSION STARTED")!.date);
const all = passes(positions, pits, start);
const input: SummaryInput = { kind: "race", laps, raceControl: rc, positions, pits, stints, passes: all, start, live: false };
const at = (hms: string) => Date.parse(`2026-09-13T${hms}Z`);

describe("passes", () => {
  it("matches OpenF1's own overtakes list", () => {
    const official = fixture<{ date: string; overtaking_driver_number: number; overtaken_driver_number: number }[]>(slug, "overtakes");
    const found = official.filter((o) => all.some((p) => p.by === o.overtaking_driver_number && p.of === o.overtaken_driver_number && Math.abs(p.t - Date.parse(o.date)) <= 3000));
    // 120 of 123; the other three are in the lap-1 scramble, where rows for one change arrive split.
    expect(found.length).toBeGreaterThanOrEqual(120);
    expect(all.length).toBeLessThanOrEqual(official.length);
  });

  it("labels places lost by pitting as pit stops, not passes on track", () => {
    for (const p of all.filter((x) => x.kind === "pit")) {
      const stop = pits.find((s) => (s.driver_number === p.by || s.driver_number === p.of) && Math.abs(p.t - Date.parse(s.date)) <= 100_000);
      expect(stop, `${p.by} passing ${p.of}`).toBeDefined();
    }
  });

  it("labels passing a retiring car only once it has visibly stopped", () => {
    // #18 broke down on its final lap: #77 went by at 13:26:40 with #18 at 8 km/h, and #18 sat
    // still from about 13:27:00.
    const telemetry = telemetryFor(slug, [{ name: "lap14-vsc-double-yellow-s5", from: "2026-09-13T13:26:30Z", to: "2026-09-13T13:29:40Z" }]);
    const finalLaps = retirements(results, laps);
    const label = (t: number) =>
      labelRetirements(all, t, {
        finalLapStart: (d) => finalLaps.get(d),
        stoppedBy: (d, at) => !!telemetry.traces.get(d) && isRetiredAt(telemetry.traces.get(d)!, finalLaps.get(d)!, at),
        speedAt: (d, at) => {
          const car = telemetry.cars.get(d);
          const i = car ? floorIndex(car.t, at) : -1;
          return car && i >= 0 && at - car.t[i] < 2000 ? car.speed[i] : null;
        },
      }).find((p) => p.by === 77 && p.of === 18)!.kind;
    expect(label(at("13:26:45"))).toBe("track");
    expect(label(at("13:27:30"))).toBe("retirement");
    // Before any results (live) or without car data, it stays a pass on track.
    expect(all.find((p) => p.by === 77 && p.of === 18)!.kind).toBe("track");
  });
});

describe("driver summary", () => {
  it("has the grid at lights out and the order at the end", () => {
    const grid = fixture<{ driver_number: number; position: number }[]>("2026-madrid-qualifying", "starting_grid");
    for (const g of grid) expect(driverSummary(input, g.driver_number, start + 1000).grid, `#${g.driver_number}`).toBe(g.position);
    for (const r of results.filter((x) => x.position !== null)) expect(driverSummary(input, r.driver_number, at("15:00:00")).position, `#${r.driver_number}`).toBe(r.position);
  });

  it("uses nothing from after the replay time", () => {
    const t = at("13:45:00");
    for (const d of [1, 12, 44, 63]) {
      const s = driverSummary(input, d, t);
      expect(s.pitStops.every((p) => p.t <= t)).toBe(true);
      expect(s.messages.every((m) => m.t <= t)).toBe(true);
      expect([...s.passes.made, ...s.passes.lost].every((p) => p.t <= t)).toBe(true);
      if (s.bestLap) {
        const lap = laps.find((l) => l.driver_number === d && l.lap_number === s.bestLap!.lap)!;
        expect(Date.parse(lap.date_start!) + lap.lap_duration! * 1000).toBeLessThanOrEqual(t);
      }
    }
  });

  it("leaves deleted laps out of the best lap and keeps the stop details", () => {
    // #12 on lap 25: one stop on lap 14 (medium to hard, 3.0 s stationary), two laps deleted for track limits.
    const s = driverSummary(input, 12, at("13:45:00"));
    expect(s.pitStops).toMatchObject([{ lap: 14, stationary: 3, from: "MEDIUM", to: "HARD" }]);
    expect(s.deletedLaps).toBe(2);
    expect(s.tyre).toMatchObject({ compound: "HARD", stops: 1 });
    expect(s.messages.map((m) => m.kind)).toEqual(["deleted", "deleted"]);
  });
});

describe("cars named in race control", () => {
  const row = (message: string, driver_number: number | null = null, flag: string | null = null) => ({ date: "", category: "Other", flag, scope: null, sector: null, driver_number, lap_number: null, qualifying_phase: null, message });
  it("reads every car a message names, but not blue flags", () => {
    expect(carsNamed(row("FIA STEWARDS: TURN 4 INCIDENT INVOLVING CARS 55 (SAI) AND 14 (ALO) NOTED"))).toEqual([55, 14]);
    expect(carsNamed(row("CAR 12 (ANT) TIME 1:39.145 DELETED - TRACK LIMITS AT TURN 6 LAP 23 15:41:55"))).toEqual([12]);
    expect(carsNamed(row("WAVED BLUE FLAG FOR CAR 30 (LAW) TIMED AT 13:40:01", 30, "BLUE"))).toEqual([]);
  });
});

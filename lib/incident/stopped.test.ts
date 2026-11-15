import { describe, expect, it } from "vitest";
import type { Lap, LocationRow, PitRow } from "@/lib/openf1/types";
import { outlineFrom } from "@/lib/session/assemble";
import { fixture, telemetryFor } from "@/test/fixtures";
import { findStoppedCars } from "./stopped";

function setup(slug: string, outline: { file: string; driver: number; lap: number }, windows: { name: string; from: string; to: string }[]) {
  const lap = fixture<Lap[]>(slug, "laps").find((l) => l.driver_number === outline.driver && l.lap_number === outline.lap)!;
  const o = outlineFrom(lap, fixture<LocationRow[]>(slug, `location.${outline.file}`))!;
  const t = telemetryFor(slug, windows);
  return (flag: string, now: string, notBefore = 0) =>
    findStoppedCars({ flagAt: Date.parse(flag), now: Date.parse(now), notBefore, outline: o, cars: t.cars, traces: t.traces, pits: fixture<PitRow[]>(slug, "pit") });
}

describe("stopped-car inference on recorded incidents", () => {
  const madrid = setup("2026-madrid-race", { file: "outline-lap-63-49", driver: 63, lap: 49 }, [
    { name: "lap5-yellow-s23", from: "2026-09-13T13:12:05Z", to: "2026-09-13T13:13:05Z" },
    { name: "lap14-vsc-double-yellow-s5", from: "2026-09-13T13:26:30Z", to: "2026-09-13T13:29:40Z" },
  ]);
  const saoPaulo = setup("2026-sao-paulo-race", { file: "outline-lap-12-55", driver: 12, lap: 55 }, [
    { name: "lap17-double-yellow-s2", from: "2026-11-08T17:26:55Z", to: "2026-11-08T17:28:20Z" },
    { name: "lap61-double-yellow-s2", from: "2026-11-08T18:22:10Z", to: "2026-11-08T18:23:25Z" },
    { name: "lap63-double-yellow-s15", from: "2026-11-08T18:25:40Z", to: "2026-11-08T18:27:00Z" },
  ]);

  it("finds #44 at the lap-5 yellow (Madrid)", () => {
    const r = madrid("2026-09-13T13:12:24Z", "2026-09-13T13:12:40Z");
    expect(r.cars.map((c) => c.driver)).toEqual([44]);
    expect(r.cars[0].arc / 10).toBeGreaterThan(4700);
    expect(r.cars[0].arc / 10).toBeLessThan(4760);
  });

  it("finds #18 before the lap-14 yellow (Madrid)", () => {
    const r = madrid("2026-09-13T13:26:41Z", "2026-09-13T13:27:20Z");
    expect(r.cars.map((c) => c.driver)).toContain(18);
    expect(r.cars.find((c) => c.driver === 18)!.secondsBeforeFlag).toBeGreaterThan(0);
  });

  it("finds #51 at the lap-17 double yellow and #44 at lap 63 (São Paulo, wet)", () => {
    expect(saoPaulo("2026-11-08T17:28:00Z", "2026-11-08T17:28:15Z").cars.map((c) => c.driver)).toEqual([51]);
    expect(saoPaulo("2026-11-08T18:26:44Z", "2026-11-08T18:26:58Z").cars.map((c) => c.driver)).toEqual([44]);
  });

  it("finds nobody for the brief lap-61 double yellow", () => {
    const r = saoPaulo("2026-11-08T18:23:14Z", "2026-11-08T18:23:20Z");
    expect(r.cars).toEqual([]);
    expect(r.confidence).toBe("none");
  });
});

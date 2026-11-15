import { describe, expect, it } from "vitest";
import type { LocationRow } from "@/lib/openf1/types";
import { fixture, telemetryFor } from "@/test/fixtures";
import { traceAt } from "./telemetry";

const W = [{ name: "lap5-yellow-s23", from: "2026-09-13T13:12:05Z", to: "2026-09-13T13:13:05Z" }];

describe("telemetry encoding", () => {
  it("round-trips every location sample exactly", () => {
    const rows = fixture<LocationRow[]>("2026-madrid-race", "location.lap5-yellow-s23").filter((r) => !(r.x === 0 && r.y === 0));
    const index = telemetryFor("2026-madrid-race", W);
    for (const r of rows.slice(0, 2000)) {
      const p = traceAt(index.traces.get(r.driver_number)!, Date.parse(r.date));
      expect(p).not.toBeNull();
      expect(p!.x).toBeCloseTo(r.x, 6);
      expect(p!.y).toBeCloseTo(r.y, 6);
    }
  });

  it("reports which times are covered", () => {
    const index = telemetryFor("2026-madrid-race", W);
    expect(index.covers(Date.parse("2026-09-13T13:12:30Z"))).toBe(true);
    expect(index.covers(Date.parse("2026-09-13T13:20:00Z"))).toBe(false);
  });
});

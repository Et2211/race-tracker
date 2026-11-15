import { describe, expect, it } from "vitest";
import type { Lap, PositionRow } from "@/lib/openf1/types";
import { fixture, raceControl } from "@/test/fixtures";
import { jumpTargets, lapStarts } from "./timeline";

describe("jump targets", () => {
  it("gives every race lap, in order, starting when the leader crosses the line", () => {
    const laps = fixture<Lap[]>("2026-madrid-race", "laps");
    const positions = fixture<PositionRow[]>("2026-madrid-race", "position").sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const starts = [...lapStarts(laps)].sort((a, b) => a[0] - b[0]);
    expect(starts).toHaveLength(57);
    for (let i = 1; i < starts.length; i++) expect(starts[i][1]).toBeGreaterThan(starts[i - 1][1]);
    // The first car across the line is the leader by the position feed.
    for (const [n, t] of starts) {
      const first = laps.find((l) => l.lap_number === n && l.date_start && Date.parse(l.date_start) === t)!;
      const leader = positions.filter((p) => p.position === 1 && Date.parse(p.date) <= t + 2000).at(-1);
      expect(leader?.driver_number, `lap ${n}`).toBe(first.driver_number);
    }
  });

  it("gives the first start of each qualifying phase, ignoring restarts after red flags", () => {
    const rc = raceControl("2026-sao-paulo-qualifying");
    const targets = jumpTargets("qualifying", [], rc, "Qualifying");
    expect(targets.map((t) => [t.label, new Date(t.t).toISOString()])).toEqual([
      ["Q1", "2026-11-07T18:00:00.145Z"],
      ["Q2", "2026-11-07T19:49:00.136Z"],
      ["Q3", "2026-11-07T20:14:00.131Z"],
    ]);
  });
});

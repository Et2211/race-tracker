import { describe, expect, it } from "vitest";
import type { Lap, PositionRow, SessionResult } from "@/lib/openf1/types";
import { fixture } from "@/test/fixtures";
import { buildRaceTable, classificationDifferences, gapTrend } from "./race";

describe.each(["2026-madrid-race", "2026-sao-paulo-race"])("race table from %s", (slug) => {
  const laps = fixture<Lap[]>(slug, "laps");
  const positions = fixture<PositionRow[]>(slug, "position").sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const result = fixture<SessionResult[]>(slug, "session_result");
  const end = Math.max(...laps.filter((l) => l.date_start && l.lap_duration).map((l) => Date.parse(l.date_start!) + l.lap_duration! * 1000)) + 60_000;

  it("finishes in the official order apart from the differences it reports", () => {
    const table = buildRaceTable(laps, positions, [], end);
    const diffs = classificationDifferences(table, result);
    const swapped = diffs.filter((d) => d.status === null).map((d) => [d.driver, d.onTrack, d.official]);
    // São Paulo: LEC was ahead of LAW on track; the official result has LAW P7 and LEC P8
    // (their Turn 12 collision was investigated after the race).
    expect(swapped).toEqual(slug === "2026-sao-paulo-race" ? [[30, 8, 7], [16, 7, 8]] : []);
    for (const row of table) {
      const official = result.find((r) => r.driver_number === row.driver);
      if (official?.position && !diffs.some((d) => d.driver === row.driver)) expect(row.position).toBe(official.position);
    }
  });

  it("shows each driver's final lap time", () => {
    const table = buildRaceTable(laps, positions, [], end);
    for (const row of table) {
      const last = laps.filter((l) => l.driver_number === row.driver && l.lap_duration !== null).sort((a, b) => b.lap_number - a.lap_number)[0];
      if (last) expect(row.lapTime).toBe(last.lap_duration);
    }
  });

  it("marks exactly one purple per sector across the field", () => {
    const table = buildRaceTable(laps, positions, [], end);
    // Purple is the fastest sector so far; on the final lap it may belong to nobody's last lap.
    for (const i of [0, 1, 2]) expect(table.filter((r) => r.marks[i] === "purple").length).toBeLessThanOrEqual(1);
  });

  it("leaves lapped drivers out of the gap trend rather than plotting a wrong gap", () => {
    const series = gapTrend(laps, result.filter((r) => r.position !== null).map((r) => r.driver_number), 2, 40);
    for (const s of series) for (const p of s.points) expect(p.gap).toBeLessThan(120);
  });
});

describe("gaps", () => {
  const laps: Lap[] = [];
  const positions: PositionRow[] = [
    { date: "2026-01-01T00:00:00Z", driver_number: 1, position: 1 },
    { date: "2026-01-01T00:00:00Z", driver_number: 2, position: 2 },
    { date: "2026-01-01T00:00:00Z", driver_number: 3, position: 3 },
  ];
  const t = Date.parse("2026-01-01T00:00:05Z");
  const intervals = [
    { date: "2026-01-01T00:00:01Z", driver_number: 1, gap_to_leader: 0, interval: 0 },
    { date: "2026-01-01T00:00:01Z", driver_number: 2, gap_to_leader: null, interval: null },
    { date: "2026-01-01T00:00:01Z", driver_number: 3, gap_to_leader: "+1 LAP", interval: 12.3 },
  ];
  it("treats null as the leader only for the car in first place", () => {
    const rows = buildRaceTable(laps, positions, intervals, t);
    expect(rows[1].gap).toBeNull();
    expect(rows[2].gap).toEqual({ kind: "laps", laps: 1 });
    expect(rows[2].interval).toEqual({ kind: "time", seconds: 12.3 });
  });
  it("drops gaps older than the freshness limit", () => {
    expect(buildRaceTable(laps, positions, intervals, t + 60_000).every((r) => r.gap === null)).toBe(true);
  });
});

import type { IntervalRow, Lap, PositionRow, SessionResult } from "@/lib/openf1/types";
import { parseGap, type Gap } from "./gap";
import { countUpTo, dateTimes, lapTimes } from "./time-index";
import type { Mark } from "./qualifying";

export type RaceRow = {
  driver: number;
  position: number;
  gap: Gap | null;
  interval: Gap | null;
  /** The driver's last completed lap at the snapshot time; null before their first. */
  lapNumber: number | null;
  sectors: [number | null, number | null, number | null];
  marks: [Mark, Mark, Mark];
  lapTime: number | null;
};


const driverCounts = new WeakMap<object, number>();

/**
 * Latest row at or before `t` per driver. Rows must be sorted by date. Finds where `t` falls by
 * binary search and walks back until every driver is seen, instead of scanning from the start.
 */
function latestPerDriver<T extends { date: string; driver_number: number }>(rows: T[], t: number): Map<number, T> {
  let drivers = driverCounts.get(rows);
  if (drivers === undefined) {
    drivers = new Set(rows.map((r) => r.driver_number)).size;
    driverCounts.set(rows, drivers);
  }
  const out = new Map<number, T>();
  for (let i = countUpTo(dateTimes(rows), t) - 1; i >= 0 && out.size < drivers; i--) {
    if (!out.has(rows[i].driver_number)) out.set(rows[i].driver_number, rows[i]);
  }
  return out;
}

/** The lap the leader is on at `t`: the highest lap number anyone has started. */
export function leaderLap(laps: Lap[], t: number): number {
  const { sortedStart, maxLapUpTo } = lapTimes(laps);
  const n = countUpTo(sortedStart, t);
  return n ? maxLapUpTo[n - 1] : 0;
}

/**
 * Race order with gaps and the last completed lap's splits at time `t`.
 * Purple marks a sector that is the fastest by anyone so far, green the driver's own best so far.
 * `intervals` may cover only part of the session; gaps older than `maxGapAgeMs` are left out.
 */
export function buildRaceTable(
  laps: Lap[],
  positions: PositionRow[],
  intervals: IntervalRow[],
  t: number,
  maxGapAgeMs = 15000,
): RaceRow[] {
  const order = latestPerDriver(positions, t);
  const gaps = latestPerDriver(intervals, t);
  const { end: ends } = lapTimes(laps);
  const completed = laps.filter((_, i) => ends[i] <= t);

  const keys = ["duration_sector_1", "duration_sector_2", "duration_sector_3"] as const;
  const overall = [Infinity, Infinity, Infinity];
  const personal = new Map<number, number[]>();
  const last = new Map<number, Lap>();
  for (const lap of completed) {
    const pb = personal.get(lap.driver_number) ?? [Infinity, Infinity, Infinity];
    keys.forEach((k, i) => {
      const time = lap[k];
      if (time === null) return;
      if (time < pb[i]) pb[i] = time;
      if (time < overall[i]) overall[i] = time;
    });
    personal.set(lap.driver_number, pb);
    const current = last.get(lap.driver_number);
    if (!current || lap.lap_number > current.lap_number) last.set(lap.driver_number, lap);
  }

  return [...order.values()]
    .sort((a, b) => a.position - b.position)
    .map((pos): RaceRow => {
      const lap = last.get(pos.driver_number) ?? null;
      const sectors: RaceRow["sectors"] = lap ? [lap.duration_sector_1, lap.duration_sector_2, lap.duration_sector_3] : [null, null, null];
      const pb = personal.get(pos.driver_number);
      const marks = sectors.map((time, i): Mark => (time === null ? null : time === overall[i] ? "purple" : pb && time === pb[i] ? "green" : null)) as RaceRow["marks"];
      const gapRow = gaps.get(pos.driver_number);
      const fresh = gapRow && t - Date.parse(gapRow.date) <= maxGapAgeMs;
      // null means "leader" in OpenF1, but the feed also sends null for other cars (seen for P5 at
      // the 2026 São Paulo finish). Only the car first in the position order is treated as leader.
      const asGap = (raw: IntervalRow["gap_to_leader"]) => {
        const g = parseGap(raw);
        return g.kind === "leader" && pos.position !== 1 ? null : g;
      };
      return {
        driver: pos.driver_number,
        position: pos.position,
        gap: fresh ? asGap(gapRow.gap_to_leader) : null,
        interval: fresh ? asGap(gapRow.interval) : null,
        lapNumber: lap?.lap_number ?? null,
        sectors,
        marks,
        lapTime: lap?.lap_duration ?? null,
      };
    });
}

export type TrendSeries = { driver: number; points: { lap: number; gap: number }[] };

/**
 * Gap to the leader at the end of each lap, from line-crossing times: when a driver started
 * lap n+1 minus when the first car did. Drivers a lap or more down at a crossing have no point there.
 */
export function gapTrend(laps: Lap[], drivers: number[], fromLap: number, toLap: number): TrendSeries[] {
  const starts = new Map<number, Map<number, number>>();
  const { start } = lapTimes(laps);
  laps.forEach((lap, i) => {
    if (Number.isNaN(start[i])) return;
    const byDriver = starts.get(lap.lap_number) ?? new Map<number, number>();
    byDriver.set(lap.driver_number, start[i]);
    starts.set(lap.lap_number, byDriver);
  });
  return drivers.map((driver) => {
    const points: TrendSeries["points"] = [];
    for (let lap = fromLap; lap <= toLap; lap++) {
      const next = starts.get(lap + 1);
      const mine = next?.get(driver);
      if (!next || mine === undefined) continue;
      const first = Math.min(...next.values());
      // The leader starting lap n+2 before this driver starts n+1 means the driver is lapped.
      const lapped = [...(starts.get(lap + 2)?.values() ?? [])].some((t) => t < mine);
      if (!lapped) points.push({ lap, gap: (mine - first) / 1000 });
    }
    return { driver, points };
  });
}

export type ClassificationDifference = { driver: number; onTrack: number | null; official: number | null; status: string | null };

/**
 * Where the official result differs from the order on track at the flag: penalties applied after
 * the race, disqualifications and retirements. The position feed only shows the order on track.
 */
export function classificationDifferences(table: RaceRow[], results: SessionResult[]): ClassificationDifference[] {
  const out: ClassificationDifference[] = [];
  for (const r of results) {
    const onTrack = table.find((row) => row.driver === r.driver_number)?.position ?? null;
    const status = r.dsq ? "Disqualified" : r.dns ? "Did not start" : r.dnf ? "Did not finish" : null;
    if (onTrack !== r.position || status === "Disqualified") out.push({ driver: r.driver_number, onTrack, official: r.position, status });
  }
  return out.sort((a, b) => (a.official ?? 99) - (b.official ?? 99));
}

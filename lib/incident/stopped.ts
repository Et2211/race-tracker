import type { PitRow } from "@/lib/openf1/types";
import { floorIndex, traceAt, type CarSeries, type Trace } from "@/lib/session/telemetry";
import { project, type Outline } from "@/lib/track/geometry";

// Thresholds tuned by the backtest over 31 sessions and 281 flags of the 2026 season
// (docs/m6-backtest.md). It never states fault.

export type StoppedCar = {
  driver: number;
  /** When the car first dropped below the stop speed. */
  stoppedAt: number;
  /** Positive when the car stopped before the flag was shown. */
  secondsBeforeFlag: number;
  /** Seconds below the stop speed, up to the evaluation time. */
  stationaryFor: number;
  /** Position along the lap, decimetres from the start line. */
  arc: number;
  /** Null while the car is still stopped at the evaluation time. */
  resumedAt: number | null;
};

/** Another car very close to a stopping car at the moment its speed fell sharply. */
export type PossibleContact = {
  driver: number;
  withDriver: number;
  at: number;
  /** Decimetres between the two cars (location is approximate, about ±5 m). */
  distance: number;
  /** km/h lost within one second. */
  speedDrop: number;
  resumedAt: number | null;
};

export type Confidence = "none" | "medium" | "high";
export type IncidentInference = { cars: StoppedCar[]; contacts: PossibleContact[]; confidence: Confidence };

export const DETECTOR = {
  stopSpeed: 30, // km/h; 10 and 20 found fewer of the cars race control named
  minStopMs: 1500,
  lookBackMs: 30_000, // 60 s and 90 s picked up more unrelated stops elsewhere on the lap
  afterFlagMs: 5000, // flags can precede the telemetry by a few seconds
  racingSpeed: 100, // km/h: the car must have been racing shortly before stopping
  racingWindowMs: 40_000,
  onLine: 150, // decimetres from the racing line; the pit lane and garages are further out
  pitMarginMs: 10_000,
  contactDistance: 200, // decimetres
  contactWindowMs: 3000,
  contactSpeedDrop: 60, // km/h within one second
};

/** Largest speed drop within one second in [from, to], and when it ended. */
function sharpestDrop(series: CarSeries, from: number, to: number): { drop: number; at: number } {
  let best = { drop: 0, at: from };
  let i = Math.max(0, floorIndex(series.t, from));
  for (; i < series.t.length && series.t[i] <= to; i++) {
    for (let k = i + 1; k < series.t.length && series.t[k] - series.t[i] <= 1000; k++) {
      const drop = series.speed[i] - series.speed[k];
      if (drop > best.drop) best = { drop, at: series.t[k] };
    }
  }
  return best;
}

export function findStoppedCars(input: {
  flagAt: number;
  now: number;
  /** Stops before this are the grid or the formation lap. */
  notBefore: number;
  outline: Outline;
  cars: Map<number, CarSeries>;
  traces: Map<number, Trace>;
  pits: PitRow[];
  params?: typeof DETECTOR;
}): IncidentInference {
  const { flagAt, now, notBefore, outline, cars, traces, pits } = input;
  const p = input.params ?? DETECTOR;
  const found: StoppedCar[] = [];
  const windowStart = Math.max(notBefore, flagAt - p.lookBackMs);
  const windowEnd = Math.min(now, flagAt + p.afterFlagMs);

  for (const [driver, series] of cars) {
    const { t: times, speed } = series;
    let i = Math.max(0, floorIndex(times, windowStart - p.racingWindowMs));
    while (i < times.length && times[i] <= now) {
      if (speed[i] >= p.stopSpeed) {
        if (times[i] > windowEnd) break; // moving past the window: nothing more to find
        i++;
        continue;
      }
      const start = i;
      while (i < times.length && times[i] <= now && speed[i] < p.stopSpeed) i++;
      const stoppedAt = times[start];
      if (stoppedAt > windowEnd) break;
      const resumed = i < times.length && times[i] <= now;
      const until = resumed ? times[i] : Math.min(now, times[i - 1]);
      if (until - stoppedAt < p.minStopMs || stoppedAt < windowStart) continue;

      let wasRacing = false;
      for (let k = start - 1; k >= 0 && times[k] > stoppedAt - p.racingWindowMs; k--) {
        if (speed[k] > p.racingSpeed) {
          wasRacing = true;
          break;
        }
      }
      if (!wasRacing) continue;
      if (found.some((f) => f.driver === driver)) continue; // one entry per car: its first stop
      const inPits = pits.some((pit) => {
        const at = Date.parse(pit.date);
        const lane = (pit.lane_duration ?? 30) * 1000;
        return pit.driver_number === driver && stoppedAt > at - lane - p.pitMarginMs && stoppedAt < at + lane + p.pitMarginMs;
      });
      if (inPits) continue;
      const trace = traces.get(driver);
      const where = trace ? traceAt(trace, stoppedAt) : null;
      if (!where) continue;
      const { s, offset } = project(outline, where);
      if (offset > p.onLine) continue;

      found.push({
        driver,
        stoppedAt,
        secondsBeforeFlag: (flagAt - stoppedAt) / 1000,
        stationaryFor: (until - stoppedAt) / 1000,
        arc: s,
        resumedAt: resumed ? times[i] : null,
      });
    }
  }

  found.sort((a, b) => a.stoppedAt - b.stoppedAt);

  // Possible contact: another car within a few metres of a stopping car when its speed fell sharply.
  const contacts: PossibleContact[] = [];
  for (const car of found) {
    const here = traces.get(car.driver);
    if (!here) continue;
    for (const [other, series] of cars) {
      if (other === car.driver || found.some((f) => f.driver === other) || contacts.some((c) => c.driver === other)) continue;
      const drop = sharpestDrop(series, car.stoppedAt - p.contactWindowMs, car.stoppedAt + 1000);
      if (drop.drop < p.contactSpeedDrop) continue;
      const a = traceAt(here, drop.at);
      const otherTrace = traces.get(other);
      const b = otherTrace ? traceAt(otherTrace, drop.at) : null;
      if (!a || !b) continue;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance > p.contactDistance) continue;
      let resumedAt: number | null = null;
      for (let k = floorIndex(series.t, drop.at); k >= 0 && k < series.t.length && series.t[k] <= now; k++) {
        if (series.speed[k] > p.racingSpeed) {
          resumedAt = series.t[k];
          break;
        }
      }
      contacts.push({ driver: other, withDriver: car.driver, at: drop.at, distance, speedDrop: drop.drop, resumedAt });
    }
  }
  return { cars: found, contacts, confidence: found.length === 0 ? "none" : "medium" };
}

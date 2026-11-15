import type { CarDataRow, LocationRow } from "@/lib/openf1/types";
import type { TelemetryChunk } from "./types";

const delta = (values: number[]) => values.map((v, i) => (i === 0 ? v : v - values[i - 1]));
const undelta = (values: number[]) => {
  const out = new Float64Array(values.length);
  let acc = 0;
  values.forEach((v, i) => {
    acc += v;
    out[i] = acc;
  });
  return out;
};

/** Pack raw OpenF1 rows for one window. Location rows at exactly (0, 0) mean "no position" and are dropped. */
export function encodeChunk(index: number, from: number, to: number, location: LocationRow[], carData: CarDataRow[]): TelemetryChunk {
  const drivers = new Set<number>([...location.map((r) => r.driver_number), ...carData.map((r) => r.driver_number)]);
  const cars = [...drivers].sort((a, b) => a - b).map((driver) => {
    const loc = location
      .filter((r) => r.driver_number === driver && !(r.x === 0 && r.y === 0))
      .map((r) => ({ t: Date.parse(r.date) - from, x: r.x, y: r.y }))
      .sort((a, b) => a.t - b.t);
    const car = carData
      .filter((r) => r.driver_number === driver)
      .map((r) => ({ ...r, t: Date.parse(r.date) - from }))
      .sort((a, b) => a.t - b.t);
    return {
      driver,
      loc: { t: delta(loc.map((p) => p.t)), x: delta(loc.map((p) => p.x)), y: delta(loc.map((p) => p.y)) },
      car: {
        t: delta(car.map((r) => r.t)),
        speed: car.map((r) => r.speed),
        throttle: car.map((r) => r.throttle),
        brake: car.map((r) => r.brake),
        gear: car.map((r) => r.n_gear),
        rpm: car.map((r) => r.rpm),
      },
    };
  });
  return { index, from, to, cars };
}

/** A time-sorted position trace in typed arrays. Times are epoch ms. */
export type Trace = { t: Float64Array; x: Float64Array; y: Float64Array };
/** A time-sorted car-data series. */
export type CarSeries = { t: Float64Array; speed: Float64Array; throttle: Float64Array; brake: Float64Array; gear: Float64Array; rpm: Float64Array };

export function decodeChunk(chunk: TelemetryChunk): Map<number, { trace: Trace; car: CarSeries }> {
  const out = new Map<number, { trace: Trace; car: CarSeries }>();
  for (const c of chunk.cars) {
    const lt = undelta(c.loc.t).map((v) => v + chunk.from);
    const ct = undelta(c.car.t).map((v) => v + chunk.from);
    out.set(c.driver, {
      trace: { t: lt, x: undelta(c.loc.x), y: undelta(c.loc.y) },
      car: {
        t: ct,
        speed: Float64Array.from(c.car.speed),
        throttle: Float64Array.from(c.car.throttle),
        brake: Float64Array.from(c.car.brake),
        gear: Float64Array.from(c.car.gear),
        rpm: Float64Array.from(c.car.rpm),
      },
    });
  }
  return out;
}

/** Index of the last element of a sorted array that is <= t, or -1. */
export function floorIndex(times: Float64Array, t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  if (hi < 0 || times[0] > t) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const concat = (parts: Float64Array[]) => {
  const out = new Float64Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** Telemetry for the loaded windows of a session, merged per driver. */
export class TelemetryIndex {
  private chunks = new Map<number, { from: number; to: number; data: Map<number, { trace: Trace; car: CarSeries }> }>();
  traces = new Map<number, Trace>();
  cars = new Map<number, CarSeries>();

  add(chunk: TelemetryChunk): void {
    this.chunks.set(chunk.index, { from: chunk.from, to: chunk.to, data: decodeChunk(chunk) });
    this.rebuild();
  }

  has(index: number): boolean {
    return this.chunks.has(index);
  }

  /** Whether telemetry for time t has been loaded. */
  covers(t: number): boolean {
    for (const c of this.chunks.values()) if (t >= c.from && t < c.to) return true;
    return false;
  }

  /** Whether any car has a position sample within `ms` of t (loaded windows can be empty: the 2026 Monaco race has none). */
  hasPositionsNear(t: number, ms = 5000): boolean {
    for (const trace of this.traces.values()) {
      const i = floorIndex(trace.t, t + ms);
      if (i >= 0 && trace.t[i] >= t - ms) return true;
    }
    return false;
  }

  /** Loaded [from, to) ranges, merged where adjacent. */
  ranges(): [number, number][] {
    const sorted = [...this.chunks.values()].sort((a, b) => a.from - b.from);
    const out: [number, number][] = [];
    for (const c of sorted) {
      const last = out[out.length - 1];
      if (last && c.from <= last[1]) last[1] = Math.max(last[1], c.to);
      else out.push([c.from, c.to]);
    }
    return out;
  }

  private rebuild(): void {
    const ordered = [...this.chunks.values()].sort((a, b) => a.from - b.from);
    const drivers = new Set<number>();
    for (const c of ordered) for (const d of c.data.keys()) drivers.add(d);
    this.traces = new Map();
    this.cars = new Map();
    for (const d of drivers) {
      const parts = ordered.map((c) => c.data.get(d)).filter((p) => p !== undefined);
      const tr = parts.map((p) => p.trace);
      const cs = parts.map((p) => p.car);
      this.traces.set(d, { t: concat(tr.map((p) => p.t)), x: concat(tr.map((p) => p.x)), y: concat(tr.map((p) => p.y)) });
      this.cars.set(d, {
        t: concat(cs.map((p) => p.t)),
        speed: concat(cs.map((p) => p.speed)),
        throttle: concat(cs.map((p) => p.throttle)),
        brake: concat(cs.map((p) => p.brake)),
        gear: concat(cs.map((p) => p.gear)),
        rpm: concat(cs.map((p) => p.rpm)),
      });
    }
  }
}

/** Interpolated position at time t; null outside the trace or across a gap longer than maxGapMs. */
export function traceAt(trace: Trace, t: number, maxGapMs = 2000): { x: number; y: number } | null {
  const i = floorIndex(trace.t, t);
  if (i < 0 || i >= trace.t.length - 1) return i === trace.t.length - 1 && trace.t[i] === t ? { x: trace.x[i], y: trace.y[i] } : null;
  const ta = trace.t[i];
  const tb = trace.t[i + 1];
  if (tb - ta > maxGapMs) return null;
  const f = (t - ta) / (tb - ta || 1);
  return { x: trace.x[i] + (trace.x[i + 1] - trace.x[i]) * f, y: trace.y[i] + (trace.y[i + 1] - trace.y[i]) * f };
}

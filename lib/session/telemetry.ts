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

/** A Float64Array that grows by doubling, so appending a second of data copies only that second. */
class Growable {
  private a = new Float64Array(256);
  private n = 0;
  push(src: Float64Array) {
    const need = this.n + src.length;
    if (need > this.a.length) {
      let cap = this.a.length;
      while (cap < need) cap *= 2;
      const b = new Float64Array(cap);
      b.set(this.a.subarray(0, this.n));
      this.a = b;
    }
    this.a.set(src, this.n);
    this.n = need;
  }
  view() {
    return this.a.subarray(0, this.n);
  }
}

type DriverBuffers = { t: Growable; x: Growable; y: Growable; ct: Growable; speed: Growable; throttle: Growable; brake: Growable; gear: Growable; rpm: Growable };
const newBuffers = (): DriverBuffers => ({ t: new Growable(), x: new Growable(), y: new Growable(), ct: new Growable(), speed: new Growable(), throttle: new Growable(), brake: new Growable(), gear: new Growable(), rpm: new Growable() });

/**
 * Telemetry for the loaded parts of a session, merged per driver. Pieces that come after
 * everything loaded so far (a replay's next window, a live session's newest seconds) are
 * appended in place; anything earlier, or a piece replacing one already loaded, rebuilds the
 * merged arrays from all pieces.
 */
export class TelemetryIndex {
  private chunks = new Map<number, { from: number; to: number; data: Map<number, { trace: Trace; car: CarSeries }> }>();
  private buffers = new Map<number, DriverBuffers>();
  private end = -Infinity;
  private rangeCache: [number, number][] | null = null;
  traces = new Map<number, Trace>();
  cars = new Map<number, CarSeries>();

  add(chunk: TelemetryChunk): void {
    this.addMany([chunk]);
  }

  addMany(chunks: TelemetryChunk[]): void {
    if (chunks.length === 0) return;
    const sorted = [...chunks].sort((a, b) => a.from - b.from);
    let inOrder = true;
    let end = this.end;
    for (const c of sorted) {
      if (this.chunks.has(c.index) || c.from < end) inOrder = false;
      end = Math.max(end, c.to);
    }
    const decoded = sorted.map((c) => ({ c, data: decodeChunk(c) }));
    for (const { c, data } of decoded) this.chunks.set(c.index, { from: c.from, to: c.to, data });
    this.rangeCache = null;
    if (inOrder) {
      for (const { data } of decoded) this.append(data);
      this.end = end;
    } else {
      this.rebuild();
    }
  }

  has(index: number): boolean {
    return this.chunks.has(index);
  }

  /** Whether telemetry for time t has been loaded. */
  covers(t: number): boolean {
    const r = this.ranges();
    let lo = 0;
    let hi = r.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (t < r[mid][0]) hi = mid - 1;
      else if (t >= r[mid][1]) lo = mid + 1;
      else return true;
    }
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
    if (this.rangeCache) return this.rangeCache;
    const sorted = [...this.chunks.values()].sort((a, b) => a.from - b.from);
    const out: [number, number][] = [];
    for (const c of sorted) {
      const last = out[out.length - 1];
      if (last && c.from <= last[1]) last[1] = Math.max(last[1], c.to);
      else out.push([c.from, c.to]);
    }
    this.rangeCache = out;
    return out;
  }

  private append(data: Map<number, { trace: Trace; car: CarSeries }>): void {
    for (const [d, { trace, car }] of data) {
      let b = this.buffers.get(d);
      if (!b) this.buffers.set(d, (b = newBuffers()));
      b.t.push(trace.t);
      b.x.push(trace.x);
      b.y.push(trace.y);
      b.ct.push(car.t);
      b.speed.push(car.speed);
      b.throttle.push(car.throttle);
      b.brake.push(car.brake);
      b.gear.push(car.gear);
      b.rpm.push(car.rpm);
      this.traces.set(d, { t: b.t.view(), x: b.x.view(), y: b.y.view() });
      this.cars.set(d, { t: b.ct.view(), speed: b.speed.view(), throttle: b.throttle.view(), brake: b.brake.view(), gear: b.gear.view(), rpm: b.rpm.view() });
    }
  }

  private rebuild(): void {
    this.buffers = new Map();
    this.traces = new Map();
    this.cars = new Map();
    this.end = -Infinity;
    for (const c of [...this.chunks.values()].sort((a, b) => a.from - b.from)) {
      this.append(c.data);
      this.end = Math.max(this.end, c.to);
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

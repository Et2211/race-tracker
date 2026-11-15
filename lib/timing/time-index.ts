import type { Lap } from "@/lib/openf1/types";

/**
 * Times parsed once per data array (arrays are not changed after they are built; live mode
 * replaces an array when its rows change), so code run several times a second can binary-search
 * by time instead of parsing every row's date each time.
 */
const dates = new WeakMap<object, Float64Array>();

/** `Date.parse(row.date)` for each row. */
export function dateTimes(rows: readonly { date: string }[]): Float64Array {
  let out = dates.get(rows);
  if (!out) {
    out = Float64Array.from(rows, (r) => Date.parse(r.date));
    dates.set(rows, out);
  }
  return out;
}

/** The number of times at or before t, in a sorted array (the index of the first one after t). */
export function countUpTo(times: Float64Array, t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export type LapTimes = {
  /** Start and end of each lap (NaN / Infinity when unknown), in the same order as the laps array. */
  start: Float64Array;
  end: Float64Array;
  /** Lap starts sorted, with the highest lap number started up to each one. */
  sortedStart: Float64Array;
  maxLapUpTo: Int32Array;
};
const laps = new WeakMap<object, LapTimes>();

export function lapTimes(rows: readonly Lap[]): LapTimes {
  let out = laps.get(rows);
  if (!out) {
    const start = Float64Array.from(rows, (l) => (l.date_start ? Date.parse(l.date_start) : NaN));
    const end = Float64Array.from(rows, (l, i) => (l.date_start && l.lap_duration !== null ? start[i] + l.lap_duration * 1000 : Infinity));
    const order = rows.map((_, i) => i).filter((i) => !Number.isNaN(start[i])).sort((a, b) => start[a] - start[b]);
    const sortedStart = Float64Array.from(order, (i) => start[i]);
    const maxLapUpTo = new Int32Array(order.length);
    let max = 0;
    order.forEach((i, k) => {
      max = Math.max(max, rows[i].lap_number);
      maxLapUpTo[k] = max;
    });
    out = { start, end, sortedStart, maxLapUpTo };
    laps.set(rows, out);
  }
  return out;
}

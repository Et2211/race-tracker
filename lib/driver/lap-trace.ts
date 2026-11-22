import { floorIndex, type CarSeries, type Trace } from "@/lib/session/telemetry";
import type { Outline } from "@/lib/track/geometry";

/**
 * One lap of car data placed by distance round the lap, for comparing laps.
 *
 * Location and car data are sampled about 3.7 times a second each, on different timestamps.
 * Each location sample is projected onto the session's outline (searching only near the previous
 * sample, so tracks that cross or run alongside themselves don't jump); car-data samples get
 * their distance by interpolating between the location samples either side. The lap starts and
 * ends where the car crosses the outline's start (s = 0), which is the same place for every car,
 * rather than at the lap's `date_start`, which OpenF1 calls approximate.
 *
 * Location timestamps jitter, so the crossings found this way are off by ~50 ms typically and
 * up to a second where the feed has gaps (Suzuka 2026 has 1.2 s holes). The official lap and
 * sector times are exact, so the trace's times are then pinned to them: at the line and at both
 * sector boundaries the time is the official one, and the correction is spread linearly by
 * distance in between. Checked on six 2026 sessions with only the line pinned, the sector
 * boundaries landed within ~50–100 ms of the official sector times (p90 under 0.2 s), which is
 * the accuracy between boundaries.
 *
 * Distances are metres; the outline is in decimetres.
 */
export type LapTrace = {
  driver: number;
  lap: number;
  /** Epoch ms when the car crossed the line to start the lap. */
  start: number;
  /** Line to line, ms. */
  duration: number;
  /** Lap length along the outline, metres. */
  length: number;
  /** Sorted by distance. */
  d: Float64Array;
  /** Ms since the lap started. */
  t: Float64Array;
  speed: Float64Array;
  throttle: Float64Array;
  /** 1 when the brake is on (OpenF1 sends 0 or about 100). */
  brake: Float64Array;
  gear: Float64Array;
};

const MARGIN_MS = 4000;
/** How far either side of the expected position to look, decimetres (a car at 360 km/h covers ~100 m per location sample at worst). */
const SEARCH_DM = 3000;
/** A location sample further than this from the outline is not trusted (pit lane, off track), decimetres. */
const MAX_OFFSET_DM = 400;
/** Location samples further apart than this leave a hole the lap can't be measured across. */
const MAX_GAP_MS = 2000;
/** If the measured lap differs from the official time by more than this, the position data is not trusted. */
const MAX_TIMING_MISMATCH_MS = 1500;

/**
 * The distance a lap's speed trace adds up to must be within this of the outline's length. On 32
 * stored 2026 sessions the median is within 1 %; the Hungaroring race's outline (3.68 km, from a lap
 * with a hole in its position data, against 4.38 km driven) is 18 % short and would misplace
 * everything along it.
 */
const MAX_LENGTH_MISMATCH = 0.1;

/** The lap's official timing, to pin the trace to. Sector times may be missing. */
export type OfficialLap = { lapMs: number; sector1Ms: number | null; sector2Ms: number | null };

/** Nearest outline position to (x, y), looking only within `SEARCH_DM` of `near` when given. */
function projectNear(outline: Outline, x: number, y: number, near: number | null): { s: number; offset: number } {
  const pts = outline.points;
  const L = outline.length;
  let best = { s: 0, offset: Infinity };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (near !== null) {
      const mid = (a.s + b.s) / 2;
      let dist = Math.abs(mid - near);
      dist = Math.min(dist, L - dist);
      if (dist > SEARCH_DM) continue;
    }
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy || 1;
    const f = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / len2));
    const offset = Math.hypot(x - (a.x + f * vx), y - (a.y + f * vy));
    if (offset < best.offset) best = { s: a.s + f * (b.s - a.s), offset };
  }
  return best;
}

/** Time at which an increasing series `u` (sampled at `t`) passes `target`, by interpolation; null if it never does. */
function crossing(t: number[], u: number[], target: number): number | null {
  for (let i = 1; i < u.length; i++) {
    if (u[i - 1] < target && u[i] >= target) {
      if (t[i] - t[i - 1] > MAX_GAP_MS) return null;
      return t[i - 1] + ((target - u[i - 1]) / (u[i] - u[i - 1] || 1)) * (t[i] - t[i - 1]);
    }
  }
  return null;
}

/**
 * The lap as a trace by distance, or a reason it can't be measured. `lapStart` is the lap's
 * `date_start`; with the official lap time it bounds the search for the line crossings.
 */
export function lapTrace(
  outline: Outline,
  trace: Trace,
  car: CarSeries,
  driver: number,
  lap: number,
  lapStart: number,
  official: OfficialLap,
): LapTrace | { error: string } {
  const lapMs = official.lapMs;
  const from = lapStart - MARGIN_MS;
  const to = lapStart + lapMs + MARGIN_MS;
  const L = outline.length;

  // Location samples around the lap, as unwrapped distance along the outline.
  const tl: number[] = [];
  const u: number[] = [];
  let prevS: number | null = null;
  let turns = 0;
  for (let i = Math.max(0, floorIndex(trace.t, from)); i < trace.t.length && trace.t[i] <= to; i++) {
    if (trace.t[i] < from) continue;
    const p = projectNear(outline, trace.x[i], trace.y[i], prevS);
    if (p.offset > MAX_OFFSET_DM) {
      // Off the outline (pit lane, run-off): measuring across it would be guesswork.
      if (tl.length && trace.t[i] > lapStart && trace.t[i] < lapStart + lapMs) return { error: "The car left the racing line during this lap." };
      continue;
    }
    if (prevS !== null && p.s < prevS - L / 2) turns++;
    else if (prevS !== null && p.s > prevS + L / 2) turns--;
    prevS = p.s;
    tl.push(trace.t[i]);
    u.push(p.s + turns * L);
  }
  if (tl.length < 10) return { error: "No position data for this lap." };
  for (let i = 1; i < tl.length; i++) {
    if (tl[i] - tl[i - 1] > MAX_GAP_MS && tl[i] > lapStart && tl[i - 1] < lapStart + lapMs) return { error: "Position data has a gap during this lap." };
  }

  // The line crossings nearest the lap's start and end.
  const near = (time: number) => {
    const i = Math.max(0, Math.min(tl.length - 1, floorIndex(Float64Array.from(tl), time)));
    return u[i];
  };
  const k0 = Math.round(near(lapStart) / L);
  const start = crossing(tl, u, k0 * L);
  const end = crossing(tl, u, (k0 + 1) * L);
  if (start === null || end === null) return { error: "The lap's start or end is outside the loaded data." };

  // Car-data samples within the lap, placed by distance.
  const out = { d: [] as number[], t: [] as number[], speed: [] as number[], throttle: [] as number[], brake: [] as number[], gear: [] as number[] };
  let j = 0;
  for (let i = Math.max(0, floorIndex(car.t, start)); i < car.t.length && car.t[i] <= end; i++) {
    const ct = car.t[i];
    if (ct < start) continue;
    while (j < tl.length - 2 && tl[j + 1] < ct) j++;
    const f = (ct - tl[j]) / (tl[j + 1] - tl[j] || 1);
    const dist = (u[j] + f * (u[j + 1] - u[j]) - k0 * L) / 10;
    out.d.push(Math.max(0, dist));
    out.t.push(ct - start);
    out.speed.push(car.speed[i]);
    out.throttle.push(car.throttle[i]);
    out.brake.push(car.brake[i] > 0 ? 1 : 0);
    out.gear.push(car.gear[i]);
  }
  if (out.d.length < 10) return { error: "No car data for this lap." };
  let driven = 0;
  for (let i = Math.max(0, floorIndex(car.t, start)); i < car.t.length - 1 && car.t[i] < end; i++) driven += (car.speed[i] / 3.6) * ((Math.min(car.t[i + 1], end) - Math.max(car.t[i], start)) / 1000);
  if (Math.abs(driven / (L / 10) - 1) > MAX_LENGTH_MISMATCH) {
    return { error: `The track outline doesn't match this lap: the car drove ${(driven / 1000).toFixed(2)} km, the outline is ${(L / 10000).toFixed(2)} km.` };
  }
  if (Math.abs(end - start - lapMs) > MAX_TIMING_MISMATCH_MS) return { error: "Position data doesn't line up with this lap's timing." };
  // Interpolation can put neighbouring samples a hair out of order; keep distance non-decreasing.
  for (let i = 1; i < out.d.length; i++) if (out.d[i] < out.d[i - 1]) out.d[i] = out.d[i - 1];

  // Pin to the official times at the line and the sector boundaries.
  const length = L / 10;
  const raw: LapTrace = { driver, lap, start, duration: end - start, length, d: Float64Array.from(out.d), t: Float64Array.from(out.t), speed: new Float64Array(), throttle: new Float64Array(), brake: new Float64Array(), gear: new Float64Array() };
  const anchors: [number, number][] = [[0, 0]];
  if (official.sector1Ms !== null) anchors.push([outline.s1 / 10, official.sector1Ms]);
  if (official.sector1Ms !== null && official.sector2Ms !== null) anchors.push([outline.s2 / 10, official.sector1Ms + official.sector2Ms]);
  anchors.push([length, lapMs]);
  const corr = anchors.map(([d, ms]) => ({ d, c: ms - (d >= length ? raw.duration : timeAtDistance(raw, d)) }));
  const t = Float64Array.from(out.t, (time, i) => {
    const d = out.d[i];
    let k = 1;
    while (k < corr.length - 1 && corr[k].d < d) k++;
    const a = corr[k - 1];
    const b = corr[k];
    const f = Math.max(0, Math.min(1, (d - a.d) / (b.d - a.d || 1)));
    return time + a.c + f * (b.c - a.c);
  });
  for (let i = 1; i < t.length; i++) if (t[i] < t[i - 1]) t[i] = t[i - 1];
  return {
    driver,
    lap,
    start,
    duration: lapMs,
    length,
    d: Float64Array.from(out.d),
    t,
    speed: Float64Array.from(out.speed),
    throttle: Float64Array.from(out.throttle),
    brake: Float64Array.from(out.brake),
    gear: Float64Array.from(out.gear),
  };
}

/** Time into the lap (ms) when the trace reached distance `d` metres, interpolated. */
export function timeAtDistance(lap: LapTrace, d: number): number {
  const n = lap.d.length;
  if (d <= lap.d[0]) return lap.t[0] * (d / (lap.d[0] || 1));
  if (d >= lap.d[n - 1]) return lap.t[n - 1] + ((d - lap.d[n - 1]) / Math.max(1, lap.length - lap.d[n - 1])) * (lap.duration - lap.t[n - 1]);
  const i = floorIndex(lap.d, d);
  const f = (d - lap.d[i]) / (lap.d[i + 1] - lap.d[i] || 1);
  return lap.t[i] + f * (lap.t[i + 1] - lap.t[i]);
}

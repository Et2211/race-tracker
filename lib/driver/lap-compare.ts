import type { Lap, RaceControl } from "@/lib/openf1/types";
import { floorIndex } from "@/lib/session/telemetry";
import { deletedLaps, isDeleted } from "@/lib/timing/qualifying";
import { timeAtDistance, type LapTrace, type OfficialLap } from "./lap-trace";

/** A completed lap someone could pick to compare. */
export type LapOption = {
  driver: number;
  lap: number;
  time: number;
  sectors: [number | null, number | null, number | null];
  start: number;
  deleted: boolean;
  /** Why the lap is not a normal flying lap, if it isn't. */
  note: "first" | "out" | "in" | null;
};

/** Every lap finished by `t` with a time, per driver, oldest first. */
export function lapOptions(laps: Lap[], raceControl: RaceControl[], t: number): LapOption[] {
  const deleted = deletedLaps(raceControl.filter((r) => Date.parse(r.date) <= t));
  const outLap = new Set(laps.filter((l) => l.is_pit_out_lap).map((l) => `${l.driver_number}:${l.lap_number}`));
  return laps
    .filter((l) => l.date_start && l.lap_duration !== null && Date.parse(l.date_start) + l.lap_duration * 1000 <= t)
    .map((l) => ({
      driver: l.driver_number,
      lap: l.lap_number,
      time: l.lap_duration!,
      sectors: [l.duration_sector_1, l.duration_sector_2, l.duration_sector_3] as LapOption["sectors"],
      start: Date.parse(l.date_start!),
      deleted: isDeleted(l, deleted),
      note: l.lap_number === 1 ? ("first" as const) : l.is_pit_out_lap ? ("out" as const) : outLap.has(`${l.driver_number}:${l.lap_number + 1}`) ? ("in" as const) : null,
    }))
    .sort((a, b) => a.driver - b.driver || a.lap - b.lap);
}

/** The fastest lap that counts (not deleted, not lap 1 or a pit lap), or null. */
export function bestOption(options: LapOption[], driver?: number): LapOption | null {
  let best: LapOption | null = null;
  for (const o of options) {
    if ((driver !== undefined && o.driver !== driver) || o.deleted || o.note) continue;
    if (!best || o.time < best.time) best = o;
  }
  return best;
}

export const officialOf = (o: LapOption): OfficialLap => ({ lapMs: o.time * 1000, sector1Ms: o.sectors[0] !== null ? o.sectors[0] * 1000 : null, sector2Ms: o.sectors[1] !== null ? o.sectors[1] * 1000 : null });

/** A channel's value at distance `d` metres: interpolated for speed and throttle, the last sample for brake and gear. */
export function valueAt(lap: LapTrace, channel: "speed" | "throttle" | "brake" | "gear", d: number): number {
  const i = Math.max(0, floorIndex(lap.d, d));
  const a = lap[channel][i];
  if (channel === "brake" || channel === "gear" || i >= lap.d.length - 1) return a;
  const f = (d - lap.d[i]) / (lap.d[i + 1] - lap.d[i] || 1);
  return a + Math.max(0, Math.min(1, f)) * (lap[channel][i + 1] - a);
}

/**
 * How far ahead lap A is of lap B at each distance, seconds (positive: A got there sooner).
 * Sampled every `step` metres over the shorter of the two laps, then averaged over `smooth`
 * metres either side: placing samples along the lap jitters by a few hundredths of a second,
 * below the ~0.1 s the gap is good to anyway. The ends are left exact (both laps start level and
 * end at their official times).
 */
export function deltaTrace(a: LapTrace, b: LapTrace, step = 10, smooth = 25): { d: number[]; delta: number[] } {
  const end = Math.min(a.length, b.length);
  const d: number[] = [];
  const raw: number[] = [];
  for (let x = 0; x <= end; x += step) {
    d.push(x);
    raw.push((timeAtDistance(b, x) - timeAtDistance(a, x)) / 1000);
  }
  const k = Math.round(smooth / step);
  const delta = raw.map((v, i) => {
    const from = Math.max(0, i - k);
    const to = Math.min(raw.length - 1, i + k);
    const n = Math.min(i - from, to - i);
    let sum = 0;
    for (let j = i - n; j <= i + n; j++) sum += raw[j];
    return sum / (2 * n + 1);
  });
  return { d, delta };
}

export function topAndMinSpeed(lap: LapTrace): { top: number; min: number } {
  let top = -Infinity;
  let min = Infinity;
  for (const v of lap.speed) {
    top = Math.max(top, v);
    min = Math.min(min, v);
  }
  return { top, min };
}

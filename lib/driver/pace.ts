import type { Lap, PitRow, RaceControl, Stint } from "@/lib/openf1/types";
import { deletedLaps, isDeleted } from "@/lib/timing/qualifying";

/**
 * A driver's race pace so far: every completed lap with what may have affected it, and per stint
 * the typical lap and how it changed as the tyres aged.
 *
 * Laps that don't show pace are kept but marked: lap 1 (standing start), the laps into and out of
 * the pits, laps run partly under a safety car, virtual safety car or red flag, and laps more than
 * 7 % slower than the driver's best so far (a problem, an incident, a spin). Only "clean" laps go
 * into a stint's typical lap and trend.
 */
export type PaceLap = {
  lap: number;
  /** Seconds. */
  time: number;
  /** Epoch ms when the lap ended. */
  end: number;
  stint: number | null;
  compound: string | null;
  /** Laps the tyres had done at the start of this lap. */
  age: number | null;
  status: "clean" | "first" | "in" | "out" | "neutralised" | "slow";
  deleted: boolean;
};

export type StintPace = {
  stint: number;
  compound: string | null;
  fromLap: number;
  /** Last lap completed so far in this stint. */
  toLap: number;
  laps: number;
  cleanLaps: number;
  /** Median clean lap, seconds. */
  median: number | null;
  /** Least-squares change in clean lap time per lap of tyre age, s/lap; null with too few clean laps. */
  trend: number | null;
};

/** A lap this much slower than the driver's best so far is not a pace lap. */
const SLOW_RATIO = 1.07;
/** Fewest clean laps, and tyre-age span, for a trend to be shown. */
const MIN_TREND_LAPS = 5;
const MIN_TREND_SPAN = 4;

/** Stretches with the field neutralised: SC or VSC until the track goes green, red flag until the restart. */
export function neutralisedPeriods(raceControl: RaceControl[]): [number, number][] {
  const out: [number, number][] = [];
  let open: number | null = null;
  let red: number | null = null;
  for (const r of raceControl) {
    const at = Date.parse(r.date);
    if (r.category === "SafetyCar" && /^(VSC|SAFETY CAR) DEPLOYED/.test(r.message)) open ??= at;
    else if (open !== null && r.scope === "Track" && (r.flag === "CLEAR" || r.flag === "GREEN")) {
      out.push([open, at]);
      open = null;
    }
    if (r.flag === "RED" || r.message === "SESSION ABORTED") red ??= at;
    else if (red !== null && r.message === "SESSION STARTED") {
      out.push([red, at]);
      red = null;
    }
  }
  if (open !== null) out.push([open, Infinity]);
  if (red !== null) out.push([red, Infinity]);
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function slope(points: { x: number; y: number }[]): number | null {
  if (points.length < MIN_TREND_LAPS) return null;
  const xs = points.map((p) => p.x);
  if (Math.max(...xs) - Math.min(...xs) < MIN_TREND_SPAN) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = points.reduce((a, p) => a + p.y, 0) / points.length;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  return den ? num / den : null;
}

export function driverPace(laps: Lap[], stints: Stint[] | null, raceControl: RaceControl[], pits: PitRow[], neutral: [number, number][], driver: number, t: number): { laps: PaceLap[]; stints: StintPace[] } {
  const deleted = deletedLaps(raceControl.filter((r) => Date.parse(r.date) <= t));
  const mine = laps
    .filter((l) => l.driver_number === driver && l.date_start && l.lap_duration !== null && Date.parse(l.date_start) + l.lap_duration * 1000 <= t)
    .sort((a, b) => a.lap_number - b.lap_number);
  const pitLaps = new Set(pits.filter((p) => p.driver_number === driver && Date.parse(p.date) <= t).map((p) => p.lap_number));
  const outLaps = new Set(mine.filter((l) => l.is_pit_out_lap).map((l) => l.lap_number));
  const myStints = (stints ?? []).filter((s) => s.driver_number === driver && s.lap_start !== null).sort((a, b) => a.stint_number - b.stint_number);

  const best = Math.min(...mine.filter((l) => l.lap_number > 1).map((l) => l.lap_duration!));
  const paceLaps: PaceLap[] = mine.map((l) => {
    const start = Date.parse(l.date_start!);
    const end = start + l.lap_duration! * 1000;
    // The stint the lap belongs to: the last one started by then (a stint's end isn't known until it ends).
    const stint = myStints.filter((s) => s.lap_start! <= l.lap_number).at(-1) ?? null;
    const status: PaceLap["status"] =
      l.lap_number === 1 ? "first" : pitLaps.has(l.lap_number) || outLaps.has(l.lap_number + 1) ? "in" : l.is_pit_out_lap ? "out" : neutral.some(([a, b]) => start < b && end > a) ? "neutralised" : l.lap_duration! > best * SLOW_RATIO ? "slow" : "clean";
    return {
      lap: l.lap_number,
      time: l.lap_duration!,
      end,
      stint: stint?.stint_number ?? null,
      compound: stint?.compound ?? null,
      age: stint && stint.tyre_age_at_start !== null ? stint.tyre_age_at_start + (l.lap_number - stint.lap_start!) : null,
      status,
      deleted: isDeleted(l, deleted),
    };
  });

  const stintPace: StintPace[] = [];
  for (const s of myStints) {
    const inStint = paceLaps.filter((p) => p.stint === s.stint_number);
    if (!inStint.length) continue;
    const clean = inStint.filter((p) => p.status === "clean");
    stintPace.push({
      stint: s.stint_number,
      compound: s.compound,
      fromLap: s.lap_start!,
      toLap: inStint.at(-1)!.lap,
      laps: inStint.length,
      cleanLaps: clean.length,
      median: median(clean.map((p) => p.time)),
      trend: slope(clean.filter((p) => p.age !== null).map((p) => ({ x: p.age!, y: p.time }))),
    });
  }
  return { laps: paceLaps, stints: stintPace };
}

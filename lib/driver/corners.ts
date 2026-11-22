import { project, type Outline } from "@/lib/track/geometry";
import { timeAtDistance, type LapTrace } from "./lap-trace";

/**
 * Corners along the lap, and how two laps took each one.
 *
 * Positions come from MultiViewer's circuit file (numbered as on the official map, so "T6" matches
 * race control's "TURN 6"), projected onto the session's outline. A file that doesn't fit the
 * outline (any corner more than 30 m off it, or out of lap order: the layout changed, as the 2021
 * Hungaroring file does) is not used. Without one, corners are found from the reference lap's speed
 * trace: every point where the car slows by at least 25 km/h and speeds up again by as much. Those
 * are numbered here and are not official turn numbers.
 */
export type Corner = { label: string; /** Metres from the line. */ d: number };
/** What `/api/sessions/[key]/corners` returns: MultiViewer's numbered turns in OpenF1's coordinates, or none. */
export type CircuitCorners = { source: "multiviewer"; year: number | null; corners: { number: number; x: number; y: number }[] } | { source: "none" };
export type CornerSet = { source: "multiviewer" | "speed"; corners: Corner[] };

const MAX_OFFSET_M = 30;

export function cornersFromMultiViewer(outline: Outline, corners: { number: number; x: number; y: number }[]): Corner[] | null {
  if (corners.length < 3) return null;
  const placed = [...corners].sort((a, b) => a.number - b.number).map((c) => ({ c, ...project(outline, c) }));
  if (placed.some((p) => p.offset / 10 > MAX_OFFSET_M)) return null;
  let wraps = 0;
  for (let i = 1; i < placed.length; i++) if (placed[i].s < placed[i - 1].s) wraps++;
  if (wraps > 1) return null;
  return placed.map((p) => ({ label: `T${p.c.number}`, d: p.s / 10 })).sort((a, b) => a.d - b.d);
}

/** Slowing by this much, and speeding up by as much again, makes a corner. */
const MIN_DIP_KMH = 25;

export function cornersFromSpeed(lap: LapTrace): Corner[] {
  const out: number[] = [];
  const v = lap.speed;
  let peak = v[0];
  let low = Infinity;
  let lowAt = -1;
  for (let i = 0; i < v.length; i++) {
    if (lowAt < 0) {
      // Looking for a drop from the last peak.
      peak = Math.max(peak, v[i]);
      if (peak - v[i] >= MIN_DIP_KMH) {
        low = v[i];
        lowAt = i;
      }
    } else if (v[i] < low) {
      low = v[i];
      lowAt = i;
    } else if (v[i] - low >= MIN_DIP_KMH) {
      out.push(lap.d[lowAt]);
      peak = v[i];
      lowAt = -1;
    }
  }
  return out.map((d, i) => ({ label: `C${i + 1}`, d }));
}

/** How one lap took one corner. Distances are metres; null where the lap didn't do it (no braking). */
export type CornerLap = {
  /** Distance before the corner where the brake first went on. */
  brakeBefore: number | null;
  slowest: number;
  /** Speed 100 m after the slowest point; null when the car was braking for the next corner by then. */
  exit: number | null;
  /** Ms from the zone's start to its end. */
  time: number;
};

/** The stretch belonging to each corner: up to 250 m before and 150 m after, stopping halfway to its neighbours. */
export function cornerZones(corners: Corner[], length: number): { from: number; to: number }[] {
  return corners.map((c, i) => {
    const prev = i > 0 ? corners[i - 1].d : -Infinity;
    const next = i < corners.length - 1 ? corners[i + 1].d : Infinity;
    return { from: Math.max(0, c.d - 250, (prev + c.d) / 2), to: Math.min(length, c.d + 150, (c.d + next) / 2) };
  });
}

function speedAt(lap: LapTrace, d: number): number {
  let i = 0;
  while (i < lap.d.length - 1 && lap.d[i + 1] <= d) i++;
  if (i >= lap.d.length - 1) return lap.speed[lap.d.length - 1];
  const f = (d - lap.d[i]) / (lap.d[i + 1] - lap.d[i] || 1);
  return lap.speed[i] + Math.max(0, Math.min(1, f)) * (lap.speed[i + 1] - lap.speed[i]);
}

export function cornerLap(lap: LapTrace, corner: Corner, zone: { from: number; to: number }): CornerLap {
  let brakeAt: number | null = null;
  let slowest = Infinity;
  let slowestAt = corner.d;
  for (let i = 0; i < lap.d.length; i++) {
    const d = lap.d[i];
    if (d < zone.from || d > zone.to) continue;
    if (brakeAt === null && lap.brake[i] && d <= corner.d + 30) brakeAt = d;
    if (lap.speed[i] < slowest) {
      slowest = lap.speed[i];
      slowestAt = d;
    }
  }
  const exitAt = Math.min(lap.length, slowestAt + 100);
  let brakingAgain = false;
  for (let i = 0; i < lap.d.length; i++) if (lap.d[i] > slowestAt && lap.d[i] <= exitAt && lap.brake[i]) brakingAgain = true;
  return {
    brakeBefore: brakeAt === null ? null : Math.max(0, corner.d - brakeAt),
    slowest: Math.round(slowest),
    exit: brakingAgain ? null : Math.round(speedAt(lap, exitAt)),
    time: timeAtDistance(lap, zone.to) - timeAtDistance(lap, zone.from),
  };
}

export type CornerRow = { corner: Corner; a: CornerLap; b: CornerLap | null; /** Seconds lap A gained on B here (negative: lost). */ gain: number | null };

export function compareCorners(corners: Corner[], a: LapTrace, b: LapTrace | null): CornerRow[] {
  const zones = cornerZones(corners, Math.min(a.length, b?.length ?? Infinity));
  return corners.map((corner, i) => {
    const ca = cornerLap(a, corner, zones[i]);
    const cb = b ? cornerLap(b, corner, zones[i]) : null;
    return { corner, a: ca, b: cb, gain: cb ? (cb.time - ca.time) / 1000 : null };
  });
}

import type { Lap, SessionResult } from "@/lib/openf1/types";
import { traceAt, type Trace } from "@/lib/session/telemetry";
import { distance } from "@/lib/track/geometry";

/**
 * Cars that did not finish a race, with the start of the lap they retired on (a retired car's
 * last lap has a start but no time). Cars that did not start are retired from the beginning.
 */
export function retirements(results: SessionResult[], laps: Lap[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of results) {
    if (r.dns) {
      out.set(r.driver_number, -Infinity);
      continue;
    }
    if (!r.dnf) continue;
    let last: Lap | null = null;
    for (const lap of laps) if (lap.driver_number === r.driver_number && lap.date_start && (!last || lap.lap_number > last.lap_number)) last = lap;
    out.set(r.driver_number, last?.date_start ? Date.parse(last.date_start) : -Infinity);
  }
  return out;
}

/** How long a retired car must sit still before it leaves the map (longer than any pit stop, penalties included), and how far counts as still. */
export const RETIRED_STILL_MS = 15_000;
export const RETIRED_STILL_DM = 200; // 20 m: location is only good to about ±5 m

/**
 * A car that did not finish leaves the map once it is on its final lap and has stopped: parked in
 * the garage or where it broke down. While it is still moving (limping back, being pushed) it is
 * drawn. Where the trace does not reach back far enough to tell, it stays drawn.
 */
export function isRetiredAt(trace: Trace, finalLapStart: number, t: number): boolean {
  if (finalLapStart === -Infinity) return true;
  if (t < finalLapStart) return false;
  const points = [t - RETIRED_STILL_MS, t - RETIRED_STILL_MS / 2, t].map((at) => traceAt(trace, at));
  if (points.some((p) => p === null)) return false;
  const [a, b, c] = points as { x: number; y: number }[];
  return distance(a, b) < RETIRED_STILL_DM && distance(b, c) < RETIRED_STILL_DM && distance(a, c) < RETIRED_STILL_DM;
}

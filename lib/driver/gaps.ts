import type { Lap } from "@/lib/openf1/types";

/**
 * The gaps around a driver lap by lap, measured at the line: when they finished lap N, how long
 * before them the car directly ahead on the same lap had crossed, how long after them the car
 * directly behind on the same lap crossed, and how far back the leader was. This is the gap at
 * the line that the timing screens show, and the same measure "Worth watching" uses. Lapped cars
 * are on a different lap and so never count as the car ahead or behind.
 *
 * Only crossings up to `t` are used, so the car behind on the latest lap appears once it has
 * crossed too.
 */
export type GapLap = {
  lap: number;
  /** When the driver crossed the line to finish this lap. */
  t: number;
  /** Place among the cars that finished this lap, in crossing order. */
  position: number;
  ahead: { driver: number; gap: number } | null;
  behind: { driver: number; gap: number } | null;
  /** Seconds behind the first car to finish this lap; 0 for the leader. */
  toLeader: number;
};

/** When each car finished each lap: the lap's start plus its time, else the next lap's start. */
export function lineCrossings(laps: Lap[]): Map<number, { driver: number; t: number }[]> {
  const starts = new Map<string, number>();
  for (const l of laps) if (l.date_start) starts.set(`${l.driver_number}:${l.lap_number}`, Date.parse(l.date_start));
  const out = new Map<number, { driver: number; t: number }[]>();
  for (const l of laps) {
    const start = starts.get(`${l.driver_number}:${l.lap_number}`);
    const end = start !== undefined && l.lap_duration !== null ? start + l.lap_duration * 1000 : starts.get(`${l.driver_number}:${l.lap_number + 1}`);
    if (end === undefined) continue;
    let list = out.get(l.lap_number);
    if (!list) out.set(l.lap_number, (list = []));
    list.push({ driver: l.driver_number, t: end });
  }
  for (const list of out.values()) list.sort((a, b) => a.t - b.t);
  return out;
}

export function gapStory(crossings: Map<number, { driver: number; t: number }[]>, driver: number, t: number): GapLap[] {
  const out: GapLap[] = [];
  for (const [lap, all] of [...crossings.entries()].sort((a, b) => a[0] - b[0])) {
    const list = all.filter((c) => c.t <= t);
    const i = list.findIndex((c) => c.driver === driver);
    if (i < 0) continue;
    const me = list[i];
    out.push({
      lap,
      t: me.t,
      position: i + 1,
      ahead: i > 0 ? { driver: list[i - 1].driver, gap: (me.t - list[i - 1].t) / 1000 } : null,
      behind: i < list.length - 1 ? { driver: list[i + 1].driver, gap: (list[i + 1].t - me.t) / 1000 } : null,
      toLeader: (me.t - list[0].t) / 1000,
    });
  }
  return out;
}

import type { Lap } from "@/lib/openf1/types";

/**
 * Pairs of cars worth watching at a moment of a race: cars close enough to fight (within DRS
 * range of a second, or within two), and cars closing in on the one ahead quickly enough to
 * get there within a few laps.
 *
 * Gaps come from line crossings: the time between two cars starting the same lap. That is the
 * gap the timing screens show, measured once a lap, so the closing rate is per lap. A pit stop
 * changes the gap by twenty seconds in one lap, so a pair's trend only uses the laps after
 * either car's most recent pit exit.
 */
export type Battle = {
  ahead: number;
  behind: number;
  /** Position of the car ahead. */
  position: number;
  /** Seconds between the two at the latest crossing both have made. */
  gap: number;
  /** Seconds per lap; negative means the car behind is catching up. Null with only one crossing to go on. */
  rate: number | null;
  /** The crossing `gap` was measured at. */
  lap: number;
  kind: "fight" | "close" | "catching";
  /** For `catching`: laps until the car behind is within a second, at the current rate. */
  lapsToFight: number | null;
};

const FIGHT = 1.0;
const CLOSE = 2.0;
const CATCH_FROM = 5.0;
const CATCH_RATE = -0.2;
const CATCH_HORIZON = 8;
const WINDOW = 4;

export function battlesAt(laps: Lap[], order: number[], t: number, limit = 3): Battle[] {
  const starts = new Map<number, Map<number, number>>();
  const pitOut = new Map<number, number[]>();
  for (const lap of laps) {
    if (!lap.date_start) continue;
    const at = Date.parse(lap.date_start);
    if (at > t) continue;
    const mine = starts.get(lap.driver_number) ?? new Map<number, number>();
    mine.set(lap.lap_number, at);
    starts.set(lap.driver_number, mine);
    if (lap.is_pit_out_lap) pitOut.set(lap.driver_number, [...(pitOut.get(lap.driver_number) ?? []), lap.lap_number]);
  }

  const found: { battle: Battle; score: number }[] = [];
  for (let i = 1; i < order.length; i++) {
    const ahead = order[i - 1];
    const behind = order[i];
    const a = starts.get(ahead);
    const b = starts.get(behind);
    if (!a || !b) continue;
    // The latest lap both cars have started.
    let last = 0;
    for (const lap of b.keys()) if (a.has(lap) && lap > last) last = lap;
    // Both crossings must be current: a retired car stays in the order with its last lap long gone.
    if (last < 2 || Math.max(...a.keys()) > last + 1 || Math.max(...b.keys()) !== last) continue;
    const lastPit = Math.max(0, ...(pitOut.get(ahead) ?? []), ...(pitOut.get(behind) ?? []));
    const points: { lap: number; gap: number }[] = [];
    for (let lap = Math.max(last - WINDOW + 1, lastPit, 2); lap <= last; lap++) {
      const ta = a.get(lap);
      const tb = b.get(lap);
      if (ta !== undefined && tb !== undefined) points.push({ lap, gap: (tb - ta) / 1000 });
    }
    const now = points.at(-1);
    // More than 20 s usually means a lap down or a stop mid-lap; not a battle either way.
    if (!now || now.gap < 0 || now.gap > 20) continue;
    const first = points[0];
    const rate = points.length > 1 ? (now.gap - first.gap) / (now.lap - first.lap) : null;

    let kind: Battle["kind"] | null = null;
    let lapsToFight: number | null = null;
    if (now.gap <= FIGHT) kind = "fight";
    else if (rate !== null && rate <= CATCH_RATE && now.gap <= CATCH_FROM) {
      lapsToFight = Math.ceil((now.gap - FIGHT) / -rate);
      if (lapsToFight <= CATCH_HORIZON) kind = "catching";
    }
    if (!kind && now.gap <= CLOSE) kind = "close";
    if (!kind) continue;

    const position = i; // the car ahead is order[i - 1], so it runs in position i
    const score =
      { fight: 3, catching: 2, close: 1 }[kind] +
      (kind === "fight" ? (FIGHT - now.gap) * 0.5 : 0) +
      (rate !== null && rate < 0 ? Math.min(1, -rate) : 0) +
      (1 - Math.min(position, 20) / 20) * 0.8; // the sharp end matters a little more
    found.push({ battle: { ahead, behind, position, gap: now.gap, rate, lap: now.lap, kind, lapsToFight }, score });
  }
  return found
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((f) => f.battle);
}

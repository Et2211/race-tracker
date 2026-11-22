import type { Lap, PitRow, PositionRow, SessionResult } from "@/lib/openf1/types";

/**
 * Who passed whom, from the position feed. Each position row is one car's new place; rows for
 * the same change arrive within a second of each other, so they are grouped and the order before
 * and after each group compared: car A passed car B if A was behind B before and ahead after.
 * This reproduces OpenF1's own `overtakes` endpoint (checked on the 2026 Spanish GP: the same
 * 123 passes), which also counts places changed through pit stops and retirements; here each pass
 * is labelled with why it happened, so the driver summary can tell racing from strategy.
 */
export type Pass = {
  t: number;
  /** The car that gained the place. */
  by: number;
  /** The car that lost it. */
  of: number;
  /** The gaining car's position after the pass. */
  position: number;
  /**
   * "track": a pass on track. "pit": either car was in the pit lane, or had left it under a
   * minute earlier. "retirement": the car passed was on its last lap of a race it did not finish.
   */
  kind: "track" | "pit" | "retirement";
};

/** Rows this close together belong to one change of order. */
const GROUP_MS = 1000;
/** A pass this soon after a car left the pit lane counts as part of the stop. */
const AFTER_PIT_MS = 60_000;
/** Pit rows are stamped while the car is in the lane; allow for the entry before that. */
const BEFORE_PIT_MS = 45_000;

export function passes(positions: PositionRow[], pits: PitRow[], laps: Lap[], results: SessionResult[], start: number): Pass[] {
  const inPit = (driver: number, t: number) =>
    pits.some((p) => {
      if (p.driver_number !== driver) return false;
      const at = Date.parse(p.date);
      return t >= at - BEFORE_PIT_MS && t <= at + (p.lane_duration ?? 30) * 1000 + AFTER_PIT_MS;
    });
  // A non-finisher's last lap is the one that started but has no time.
  const retiredFrom = new Map<number, number>();
  for (const r of results) {
    if (!r.dnf) continue;
    const last = laps.filter((l) => l.driver_number === r.driver_number && l.date_start).sort((a, b) => b.lap_number - a.lap_number)[0];
    if (last?.date_start && last.lap_duration === null) retiredFrom.set(r.driver_number, Date.parse(last.date_start));
  }

  const order = new Map<number, number>();
  const out: Pass[] = [];
  let i = 0;
  while (i < positions.length) {
    const groupStart = Date.parse(positions[i].date);
    const before = new Map(order);
    let j = i;
    while (j < positions.length && Date.parse(positions[j].date) - groupStart <= GROUP_MS) {
      order.set(positions[j].driver_number, positions[j].position);
      j++;
    }
    const t = Date.parse(positions[j - 1].date);
    if (t >= start) {
      const moved = positions.slice(i, j).map((r) => r.driver_number);
      for (const a of new Set(moved)) {
        const a0 = before.get(a);
        const a1 = order.get(a)!;
        if (a0 === undefined || a1 >= a0) continue;
        for (const [b, b1] of order) {
          const b0 = before.get(b);
          if (b === a || b0 === undefined || !(a0 > b0 && a1 < b1)) continue;
          const retiring = retiredFrom.has(b) && t >= retiredFrom.get(b)!;
          const kind = inPit(a, t) || inPit(b, t) ? "pit" : retiring ? "retirement" : "track";
          out.push({ t, by: a, of: b, position: a1, kind });
        }
      }
    }
    i = j;
  }
  return out;
}

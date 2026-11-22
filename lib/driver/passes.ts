import type { PitRow, PositionRow } from "@/lib/openf1/types";

/**
 * Who passed whom, from the position feed. Each position row is one car's new place; rows for
 * the same change arrive within a second of each other, so they are grouped and the order before
 * and after each group compared: car A passed car B if A was behind B before and ahead after.
 * This reproduces OpenF1's own `overtakes` endpoint (checked on the 2026 Spanish GP: the same
 * 123 passes), which also counts places changed through pit stops and retirements; here each pass
 * is labelled with why it happened, so the driver summary can tell racing from strategy. Passing a
 * car that is retiring can only be told once the car has visibly stopped, which depends on the
 * replay time; `labelRetirements` does that.
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
   * minute earlier. "retirement": the car passed was retiring (see `labelRetirements`).
   */
  kind: "track" | "pit" | "retirement";
};

/** Rows this close together belong to one change of order. */
const GROUP_MS = 1000;
/** A pass this soon after a car left the pit lane counts as part of the stop. */
const AFTER_PIT_MS = 60_000;
/** Pit rows are stamped while the car is in the lane; allow for the entry before that. */
const BEFORE_PIT_MS = 45_000;

export function passes(positions: PositionRow[], pits: PitRow[], start: number): Pass[] {
  const inPit = (driver: number, t: number) =>
    pits.some((p) => {
      if (p.driver_number !== driver) return false;
      const at = Date.parse(p.date);
      return t >= at - BEFORE_PIT_MS && t <= at + (p.lane_duration ?? 30) * 1000 + AFTER_PIT_MS;
    });

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
          const kind = inPit(a, t) || inPit(b, t) ? "pit" : "track";
          out.push({ t, by: a, of: b, position: a1, kind });
        }
      }
    }
    i = j;
  }
  return out;
}

/** A car going slower than this when passed on its final lap was limping, not racing. */
const CRAWL_KMH = 100;

/**
 * Relabel passes of a retiring car, as far as can be seen at replay time `t`: the passed car did
 * not finish, the pass came on its final lap while it was crawling, and by `t` it has stopped for
 * good (the map's rule: still for 15 s). Until then the pass stays a pass on track, so a replay
 * doesn't give a retirement away early; a genuine pass earlier on that lap stays one. Live, with no
 * results yet, nothing is relabelled, just as the map keeps the car drawn.
 */
export function labelRetirements(all: Pass[], t: number, retired: { finalLapStart: (driver: number) => number | undefined; stoppedBy: (driver: number, t: number) => boolean; speedAt: (driver: number, at: number) => number | null }): Pass[] {
  return all.map((p) => {
    if (p.kind !== "track") return p;
    const from = retired.finalLapStart(p.of);
    if (from === undefined || p.t < from || !retired.stoppedBy(p.of, t)) return p;
    const speed = retired.speedAt(p.of, p.t);
    return speed !== null && speed < CRAWL_KMH ? { ...p, kind: "retirement" } : p;
  });
}

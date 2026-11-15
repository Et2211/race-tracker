import { describe, expect, it } from "vitest";
import type { Lap, PositionRow } from "@/lib/openf1/types";
import { fixture } from "@/test/fixtures";
import { battlesAt } from "./battles";

const T0 = Date.parse("2026-06-01T13:00:00Z");
const LAP = 90;

/** Ten laps for one driver; lap n starts `offset(n)` seconds after the leader would. */
function laps(driver: number, offset: (lap: number) => number, pitOut: number[] = []): Lap[] {
  return Array.from({ length: 10 }, (_, i) => ({
    driver_number: driver,
    lap_number: i + 1,
    date_start: new Date(T0 + ((i * LAP) + offset(i + 1)) * 1000).toISOString(),
    lap_duration: LAP,
    duration_sector_1: 30,
    duration_sector_2: 30,
    duration_sector_3: 30,
    is_pit_out_lap: pitOut.includes(i + 1),
  }) as Lap);
}

const AFTER = T0 + 11 * LAP * 1000;

describe("battles", () => {
  it("ranks a fight within a second above a car catching, and ignores a steady big gap", () => {
    const all = [
      ...laps(1, () => 0),
      ...laps(2, () => 0.6),
      ...laps(3, () => 20),
      ...laps(4, (n) => 20 + 6.0 - (n - 1) * 0.4), // catching car 3 at 0.4 s a lap, 2.4 s back on lap 10
      ...laps(5, () => 35),
    ];
    const found = battlesAt(all, [1, 2, 3, 4, 5], AFTER);
    expect(found.map((b) => [b.ahead, b.behind, b.kind])).toEqual([
      [1, 2, "fight"],
      [3, 4, "catching"],
    ]);
    expect(found[0]).toMatchObject({ position: 1, lap: 10 });
    expect(found[0].gap).toBeCloseTo(0.6, 3);
    expect(found[1].gap).toBeCloseTo(2.4, 3);
    expect(found[1].rate).toBeCloseTo(-0.4, 3);
    expect(found[1].lapsToFight).toBe(4);
  });

  it("only looks at laps started by the replay time", () => {
    const all = [...laps(1, () => 0), ...laps(2, (n) => (n <= 5 ? 0.5 : 6))];
    const atLap5 = T0 + 4.5 * LAP * 1000;
    expect(battlesAt(all, [1, 2], atLap5).map((b) => b.kind)).toEqual(["fight"]);
    expect(battlesAt(all, [1, 2], AFTER)).toEqual([]);
  });

  it("measures the trend from the latest pit exit, so a stop is not read as catching", () => {
    // Car 1 leads by 22 s, pits on lap 8 and rejoins 2 s ahead: the gap fell 20 s in one lap,
    // which over the whole window would look like car 2 closing at 6–7 s a lap.
    const all = [...laps(1, () => 0, [8]), ...laps(2, (n) => (n < 8 ? 22 : 2.0))];
    const [found] = battlesAt(all, [1, 2], AFTER);
    expect(found.kind).toBe("close");
    expect(found.rate).toBeCloseTo(0, 3);
    expect(found.lapsToFight).toBeNull();
  });

  it("ignores a retired car still listed behind", () => {
    // Car 2 was 0.5 s behind until it stopped after lap 4; car 1 carried on.
    const all = [...laps(1, () => 0), ...laps(2, () => 0.5).filter((l) => l.lap_number <= 4)];
    expect(battlesAt(all, [1, 2], AFTER)).toEqual([]);
  });

  it("leaves out a car a lap down", () => {
    const all = [...laps(1, () => 0), ...laps(2, () => LAP + 0.5)];
    expect(battlesAt(all, [1, 2], AFTER)).toEqual([]);
  });

  it("finds sensible pairs in a recorded race", () => {
    const recorded = fixture<Lap[]>("2026-madrid-race", "laps");
    const positions = fixture<PositionRow[]>("2026-madrid-race", "position");
    const lap30 = recorded.find((l) => l.lap_number === 30 && l.date_start)!;
    const t = Date.parse(lap30.date_start!);
    const latest = new Map<number, number>();
    for (const p of positions) if (Date.parse(p.date) <= t) latest.set(p.driver_number, p.position);
    const order = [...latest.entries()].sort((a, b) => a[1] - b[1]).map(([d]) => d);
    const found = battlesAt(recorded, order, t);
    expect(found.length).toBeGreaterThan(0);
    for (const b of found) {
      expect(order.indexOf(b.behind)).toBe(order.indexOf(b.ahead) + 1);
      expect(b.gap).toBeGreaterThanOrEqual(0);
      expect(b.gap).toBeLessThanOrEqual(5);
    }
  });
});

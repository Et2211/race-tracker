import { describe, expect, it } from "vitest";
import type { Lap, PositionRow, Stint } from "@/lib/openf1/types";
import { fixture } from "@/test/fixtures";
import { battlesAt, passingAid, tyreState } from "./battles";

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

  it("names DRS until 2025 and Overtake Mode from 2026", () => {
    expect(passingAid(2025)).toBe("DRS");
    expect(passingAid(2026)).toBe("Overtake Mode");
  });

  it("works out tyres and stops from the stints", () => {
    const stints = fixture<Stint[]>("2026-madrid-race", "stints");
    // #16 ran hards from the start to lap 48, then softs from lap 49.
    expect(tyreState(stints, 16, 30)).toEqual({ compound: "HARD", age: 29, stops: 0, wet: false });
    expect(tyreState(stints, 16, 52)).toEqual({ compound: "SOFT", age: 3, stops: 1, wet: false });
  });

  it("marks a car that has stopped and is catching on fresh tyres as strategy, not a fight", () => {
    const stint = (driver: number, n: number, from: number, compound: string): Stint => ({ driver_number: driver, stint_number: n, lap_start: from, lap_end: null, compound, tyre_age_at_start: 0 });
    const all = [
      ...laps(1, () => 0),
      ...laps(2, () => 0.5), // car 2 has stopped and closed right up to car 1, which has not
      ...laps(3, () => 30),
      ...laps(4, () => 31.5), // a real fight on similar tyres, 1.5 s apart
    ];
    const stints = [stint(1, 1, 1, "MEDIUM"), stint(2, 1, 1, "MEDIUM"), stint(2, 2, 6, "HARD"), stint(3, 1, 1, "MEDIUM"), stint(4, 1, 1, "MEDIUM")];
    const found = battlesAt(all, [1, 2, 3, 4], AFTER, { stints });
    expect(found.map((b) => [b.ahead, b.behind])).toEqual([
      [3, 4],
      [1, 2],
    ]);
    expect(found[0].strategy).toBeNull();
    expect(found[1].strategy).toEqual({ fresher: "behind", ageGap: 5, stopsAhead: 0, stopsBehind: 1 });
    expect(found[1].tyres.behind).toEqual({ compound: "HARD", age: 4, stops: 1, wet: false });
  });

  it("treats the same number of stops with a small tyre-age gap as a real fight", () => {
    const stint = (driver: number, from: number): Stint => ({ driver_number: driver, stint_number: from === 1 ? 1 : 2, lap_start: from, lap_end: null, compound: "HARD", tyre_age_at_start: 0 });
    const all = [...laps(1, () => 0), ...laps(2, () => 0.5)];
    const stints = [stint(1, 1), stint(1, 4), stint(2, 1), stint(2, 6)];
    const [b] = battlesAt(all, [1, 2], AFTER, { stints });
    expect(b.kind).toBe("fight");
    expect(b.strategy).toBeNull();
  });

  it("treats different stop counts on similar tyres as a real fight once both have stopped", () => {
    // Lap 45 in Madrid: #55 (two stops) 0.9 s behind #77 (one stop), tyres two laps apart.
    const stint = (driver: number, n: number, from: number): Stint => ({ driver_number: driver, stint_number: n, lap_start: from, lap_end: null, compound: "HARD", tyre_age_at_start: 0 });
    const all = [...laps(1, () => 0), ...laps(2, () => 0.9)];
    const [b] = battlesAt(all, [1, 2], AFTER, { stints: [stint(1, 1, 1), stint(1, 2, 5), stint(2, 1, 1), stint(2, 2, 3), stint(2, 3, 6)] });
    expect(b.kind).toBe("fight");
    expect(b.strategy).toBeNull();
  });

  it("does not assume a car on intermediates still has to stop", () => {
    const stint = (driver: number, compound: string): Stint => ({ driver_number: driver, stint_number: 1, lap_start: 1, lap_end: null, compound, tyre_age_at_start: 0 });
    const inter = (driver: number, n: number, from: number): Stint => ({ driver_number: driver, stint_number: n, lap_start: from, lap_end: null, compound: "INTERMEDIATE", tyre_age_at_start: 0 });
    const all = [...laps(1, () => 0), ...laps(2, () => 0.6)];
    const [b] = battlesAt(all, [1, 2], AFTER, { stints: [stint(1, "INTERMEDIATE"), stint(2, "INTERMEDIATE"), inter(2, 2, 5)] });
    expect(b.strategy).toBeNull();
  });
});

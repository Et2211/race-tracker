import { describe, expect, it } from "vitest";
import type { CarDataRow, Lap, LocationRow, RaceControl } from "@/lib/openf1/types";
import { assembleMeta } from "@/lib/session/assemble";
import type { SessionMeta } from "@/lib/session/types";
import { fixture } from "@/test/fixtures";
import { BucketCollector, decodeBucket, encodeBucket, LATE_MS } from "./buckets";
import { mergeLiveRows } from "./merge";
import { newestPerRecord, rowKey } from "./topics";

const T0 = Date.parse("2026-11-21T04:00:00Z"); // a whole second
const loc = (driver: number, ms: number): LocationRow => ({ driver_number: driver, date: new Date(T0 + ms).toISOString(), x: 100 + ms, y: -ms, z: 0 });
const car = (driver: number, ms: number): CarDataRow => ({ driver_number: driver, date: new Date(T0 + ms).toISOString(), speed: 300, throttle: 99, brake: 0, n_gear: 8, rpm: 11000 });

describe("live telemetry buckets", () => {
  it("survive encoding", () => {
    const b = { second: T0 / 1000, location: [loc(1, 120), loc(44, 870)], carData: [car(1, 50)] };
    expect(decodeBucket(b.second, encodeBucket(b).data)).toEqual(b);
  });

  it("are identical from two overlapping relays, each skipping the second it joined in", () => {
    const stream = Array.from({ length: 40 }, (_, i) => i * 250).flatMap((ms) => [loc(1, ms), loc(44, ms + 10)]);
    const early = new BucketCollector();
    const late = new BucketCollector();
    for (const row of stream) early.add("location", row);
    for (const row of stream.filter((r) => Date.parse(r.date) >= T0 + 3600)) late.add("location", row); // joins mid-second 3
    const latest = T0 + 10_000 + LATE_MS;
    const a = new Map(early.takeClosed(latest).map((b) => [b.second, encodeBucket(b).data]));
    const b = new Map(late.takeClosed(latest).map((b) => [b.second, encodeBucket(b).data]));
    expect([...b.keys()][0]).toBe(T0 / 1000 + 4); // second 3 was partial for the late relay
    for (const [second, data] of b) expect(a.get(second)).toBe(data);
  });

  it("hold a second open until samples for it can no longer arrive", () => {
    const c = new BucketCollector();
    c.add("location", loc(1, 0)); // joins at second 0, so second 1 is the first whole one
    c.add("location", loc(1, 1100));
    expect(c.takeClosed(T0 + 2000 + LATE_MS - 1)).toEqual([]);
    expect(c.takeClosed(T0 + 2000 + LATE_MS).map((b) => b.second)).toEqual([T0 / 1000 + 1]);
  });
});

describe("live rows", () => {
  const madrid = "2026-madrid-race";
  const base = (): SessionMeta =>
    assembleMeta({
      session: fixture(madrid, "session"),
      meeting: fixture(madrid, "meeting"),
      drivers: [],
      laps: [],
      raceControl: [],
      positions: [],
      intervals: [],
      pits: [],
      results: [],
      outline: null,
      outlineNote: "",
      multiviewer: null,
      learned: null,
      qualifying: null,
      source: "live",
    });

  it("replace a lap with its newer version and add new messages in time order", () => {
    const lap = fixture<Lap[]>(madrid, "laps").find((l) => l.lap_number === 10 && l.driver_number === 63)!;
    const partial = { ...lap, duration_sector_2: null, duration_sector_3: null, lap_duration: null };
    const rc = fixture<RaceControl[]>(madrid, "race_control").slice(5, 7);
    let meta = mergeLiveRows(base(), [
      { topic: "laps", payload: partial },
      { topic: "race_control", payload: rc[1] },
    ]);
    meta = mergeLiveRows(meta, [
      { topic: "laps", payload: lap },
      { topic: "race_control", payload: rc[0] },
    ]);
    expect(meta.laps).toHaveLength(1);
    expect(meta.laps[0].lap_duration).toBe(lap.lap_duration);
    expect(meta.raceControl.map((r) => r.message)).toEqual(rc.map((r) => r.message));
  });

  it("are identified by what they describe, not by the feed's keys", () => {
    expect(rowKey("laps", { driver_number: 63, lap_number: 10, _key: "x" })).toBe("63|10");
    expect(rowKey("stints", { driver_number: 63, stint_number: 2 })).toBe("63|2");
    expect(rowKey("position", { driver_number: 63 })).toBeNull(); // no date: cannot be placed
  });

  it("are written once per record, the newest version", () => {
    const rows = [
      { topic: "laps", key: "63|10", msg_id: 5, payload: { v: 1 } },
      { topic: "laps", key: "63|10", msg_id: 9, payload: { v: 2 } },
      { topic: "laps", key: "63|10", msg_id: 7, payload: { v: "stale" } },
      { topic: "laps", key: "63|11", msg_id: null, payload: { v: 3 } },
    ];
    expect(newestPerRecord(rows).map((r) => r.payload)).toEqual([{ v: 2 }, { v: 3 }]);
  });
});

import { gunzipSync, gzipSync } from "node:zlib";
import type { CarDataRow, LocationRow } from "@/lib/openf1/types";

/**
 * Car positions and telemetry arrive several times a second per car: far too many rows for a
 * database. They are kept as one bucket per second of session time, keyed by the samples' own
 * timestamps, so every relay builds identical buckets and the first one written wins.
 */
export type Bucket = { second: number; location: LocationRow[]; carData: CarDataRow[] };
export type StoredBucket = { second: number; samples: number; data: string };

/** Samples arriving later than this after their second are dropped from it (the bucket is already written). */
export const LATE_MS = 4000;

export const secondOf = (date: string) => Math.floor(Date.parse(date) / 1000);

export function encodeBucket(b: Bucket): StoredBucket {
  const base = b.second * 1000;
  const loc = b.location.map((r) => [r.driver_number, Date.parse(r.date) - base, r.x, r.y]);
  const car = b.carData.map((r) => [r.driver_number, Date.parse(r.date) - base, r.speed, r.throttle, r.brake, r.n_gear, r.rpm]);
  return { second: b.second, samples: loc.length + car.length, data: gzipSync(JSON.stringify({ loc, car })).toString("base64") };
}

export function decodeBucket(second: number, data: string): Bucket {
  const { loc, car } = JSON.parse(gunzipSync(Buffer.from(data, "base64")).toString("utf8")) as { loc: number[][]; car: number[][] };
  const base = second * 1000;
  const iso = (ms: number) => new Date(base + ms).toISOString();
  return {
    second,
    location: loc.map(([driver_number, ms, x, y]) => ({ driver_number, date: iso(ms), x, y, z: 0 })),
    carData: car.map(([driver_number, ms, speed, throttle, brake, n_gear, rpm]) => ({ driver_number, date: iso(ms), speed, throttle, brake, n_gear, rpm })),
  };
}

/**
 * Collects samples into seconds. A relay only writes seconds it saw from start to end: the first
 * second after it subscribed may be partial, so it starts with the next one.
 */
export class BucketCollector {
  private open = new Map<number, Bucket>();
  private firstComplete: number | null = null;

  add(kind: "location" | "car_data", row: LocationRow | CarDataRow) {
    const second = secondOf(row.date);
    if (this.firstComplete === null) this.firstComplete = second + 1;
    if (second < this.firstComplete) return;
    let b = this.open.get(second);
    if (!b) {
      b = { second, location: [], carData: [] };
      this.open.set(second, b);
    }
    if (kind === "location") b.location.push(row as LocationRow);
    else b.carData.push(row as CarDataRow);
  }

  /** Seconds that ended at least LATE_MS before `latest` (the newest sample time seen), oldest first. */
  takeClosed(latest: number): Bucket[] {
    const out: Bucket[] = [];
    for (const [second, b] of this.open) {
      if ((second + 1) * 1000 + LATE_MS <= latest) {
        out.push(b);
        this.open.delete(second);
      }
    }
    return out.sort((a, b) => a.second - b.second);
  }

  /** The first second this collector holds completely, or null before any sample. */
  get start(): number | null {
    return this.firstComplete;
  }
}

/** Group REST rows (used to fill a gap) into whole-second buckets. */
export function bucketsFromRows(location: LocationRow[], carData: CarDataRow[]): Bucket[] {
  const map = new Map<number, Bucket>();
  const get = (second: number) => {
    let b = map.get(second);
    if (!b) map.set(second, (b = { second, location: [], carData: [] }));
    return b;
  };
  for (const r of location) get(secondOf(r.date)).location.push(r);
  for (const r of carData) get(secondOf(r.date)).carData.push(r);
  return [...map.values()].sort((a, b) => a.second - b.second);
}

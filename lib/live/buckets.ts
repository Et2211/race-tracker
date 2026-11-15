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

/** A data type unseen for this long no longer holds back closing seconds (it may simply have gone quiet). */
export const QUIET_MS = 10_000;

/**
 * Collects samples into seconds. A relay only writes seconds it saw from start to end: the later
 * of the second after it subscribed and the second after its first sample. Seconds close once
 * every data type still arriving has moved LATE_MS past them, so car data running ahead of
 * positions cannot close a second that positions have not reached yet.
 */
export class BucketCollector {
  private open = new Map<number, Bucket>();
  private firstSample: number | null = null;
  private subscribed: number | null = null;
  private newest = new Map<"location" | "car_data", { sample: number; seenAt: number }>();

  /** The relay's subscription was confirmed at this wall-clock time. */
  setSubscribed(ms: number) {
    this.subscribed = Math.floor(ms / 1000) + 1;
    for (const second of this.open.keys()) if (second < this.subscribed) this.open.delete(second);
  }

  add(kind: "location" | "car_data", row: LocationRow | CarDataRow, receivedAt = Date.now()) {
    const ms = Date.parse(row.date);
    const second = Math.floor(ms / 1000);
    const n = this.newest.get(kind);
    this.newest.set(kind, { sample: Math.max(n?.sample ?? 0, ms), seenAt: receivedAt });
    if (this.firstSample === null) this.firstSample = second + 1;
    if (second < this.start!) return;
    let b = this.open.get(second);
    if (!b) {
      b = { second, location: [], carData: [] };
      this.open.set(second, b);
    }
    if (kind === "location") b.location.push(row as LocationRow);
    else b.carData.push(row as CarDataRow);
  }

  /** Seconds every active data type has moved LATE_MS past, oldest first. */
  takeClosed(now = Date.now()): Bucket[] {
    const active = [...this.newest.values()].filter((n) => now - n.seenAt < QUIET_MS);
    if (active.length === 0) return [];
    const closeBefore = Math.min(...active.map((n) => n.sample)) - LATE_MS;
    const out: Bucket[] = [];
    for (const [second, b] of this.open) {
      if ((second + 1) * 1000 <= closeBefore) {
        out.push(b);
        this.open.delete(second);
      }
    }
    return out.sort((a, b) => a.second - b.second);
  }

  /** Seconds still open (for the end of a relay: put back nothing, the next relay has them). */
  get pending(): number {
    return this.open.size;
  }

  /** The first second this collector holds completely, or null before any sample. */
  get start(): number | null {
    if (this.firstSample === null) return null;
    return Math.max(this.firstSample, this.subscribed ?? -Infinity);
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

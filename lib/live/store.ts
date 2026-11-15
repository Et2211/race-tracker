import "server-only";
import { supabase, supabaseConfigured } from "@/lib/storage/supabase";
import type { StoredBucket } from "./buckets";
import { newestPerRecord } from "./topics";

/** Where relays write the live feed and readers fetch it: Supabase, or memory without it (development). */
export type LiveRowWrite = { topic: string; key: string; msg_id: number | null; payload: Record<string, unknown> };
export type LiveRowRead = { topic: string; key: string; payload: Record<string, unknown>; rev: number };
export type LiveStatus = { firstSecond: number | null; lastSecond: number | null; lastRev: number; lastBucketRev: number; relaysAlive: number; lastSeen: string | null };
export type LiveBucketRead = { second: number; data: string; rev: number };
export type Heartbeat = { relayId: string; sessionKey: number; subscribedAt: string | null; messages: number; note?: string | null };
export type CalendarSession = { session_key: number; session_name: string; meeting_name: string; date_start: string; date_end: string };

/** Rows per read. Supabase returns at most 1,000 rows from a function call, so pages are that size. */
export const LIVE_PAGE = 1000;

export interface LiveStore {
  upsertRows(sessionKey: number, rows: LiveRowWrite[]): Promise<number>;
  putBuckets(sessionKey: number, buckets: StoredBucket[]): Promise<number>;
  /** At most LIVE_PAGE rows changed after `rev`, oldest change first. */
  rowsSince(sessionKey: number, rev: number): Promise<LiveRowRead[]>;
  /** At most LIVE_PAGE seconds of car data written or improved after `rev`, oldest change first. */
  bucketsSince(sessionKey: number, rev: number): Promise<LiveBucketRead[]>;
  bucketsBetween(sessionKey: number, from: number, to: number): Promise<{ second: number; data: string }[]>;
  status(sessionKey: number): Promise<LiveStatus>;
  heartbeat(beat: Heartbeat): Promise<void>;
  /** The scheduled session running now (±margins), from the calendar; null without one. */
  sessionNow(): Promise<CalendarSession | null>;
  clear(sessionKey: number): Promise<void>;
}

class SupabaseLiveStore implements LiveStore {
  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase().rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  }
  upsertRows(sessionKey: number, rows: LiveRowWrite[]) {
    // Postgres refuses one statement that updates the same record twice.
    const unique = newestPerRecord(rows);
    return unique.length ? this.rpc<number>("live_upsert_rows", { p_session_key: sessionKey, p_rows: unique }) : Promise.resolve(0);
  }
  putBuckets(sessionKey: number, buckets: StoredBucket[]) {
    return buckets.length ? this.rpc<number>("live_put_buckets", { p_session_key: sessionKey, p_buckets: buckets }) : Promise.resolve(0);
  }
  async rowsSince(sessionKey: number, rev: number) {
    const rows = await this.rpc<LiveRowRead[]>("live_rows_since", { p_session_key: sessionKey, p_rev: rev, p_limit: LIVE_PAGE });
    return rows.map((r) => ({ ...r, rev: Number(r.rev) }));
  }
  async bucketsSince(sessionKey: number, rev: number) {
    const rows = await this.rpc<LiveBucketRead[]>("live_buckets_since", { p_session_key: sessionKey, p_rev: rev, p_limit: LIVE_PAGE });
    return rows.map((r) => ({ second: Number(r.second), data: r.data, rev: Number(r.rev) }));
  }
  async bucketsBetween(sessionKey: number, from: number, to: number) {
    const rows = await this.rpc<{ second: number; data: string }[]>("live_buckets_between", { p_session_key: sessionKey, p_from: from, p_to: to });
    return rows.map((r) => ({ second: Number(r.second), data: r.data }));
  }
  async status(sessionKey: number): Promise<LiveStatus> {
    const [s] = await this.rpc<{ first_second: number | null; last_second: number | null; last_rev: number | null; last_bucket_rev: number | null; relays_alive: number; last_seen: string | null }[]>("live_status", { p_session_key: sessionKey });
    return {
      firstSecond: s?.first_second === null || s?.first_second === undefined ? null : Number(s.first_second),
      lastSecond: s?.last_second === null || s?.last_second === undefined ? null : Number(s.last_second),
      lastRev: Number(s?.last_rev ?? 0),
      lastBucketRev: Number(s?.last_bucket_rev ?? 0),
      relaysAlive: s?.relays_alive ?? 0,
      lastSeen: s?.last_seen ?? null,
    };
  }
  async heartbeat(beat: Heartbeat) {
    const { error } = await supabase()
      .from("live_relays")
      .upsert({ relay_id: beat.relayId, session_key: beat.sessionKey, subscribed_at: beat.subscribedAt, last_seen: new Date().toISOString(), messages: beat.messages, note: beat.note ?? null });
    if (error) throw new Error(`live_relays: ${error.message}`);
  }
  async sessionNow() {
    const rows = await this.rpc<CalendarSession[]>("live_session_now", {});
    return rows[0] ?? null;
  }
  async clear(sessionKey: number) {
    await this.rpc<void>("live_clear", { p_session_key: sessionKey });
  }
}

/** Values that are set (not null) in a row: a REST row may fill in a version from the feed with fewer. */
const setFields = (p: Record<string, unknown>) => Object.values(p).filter((v) => v !== null && v !== undefined).length;

/** Same rules as the SQL functions (see the live migrations), in this process only. */
class MemoryLiveStore implements LiveStore {
  private rows = new Map<string, { sessionKey: number; topic: string; key: string; msgId: number | null; payload: Record<string, unknown>; rev: number }>();
  private buckets = new Map<string, { sessionKey: number; second: number; samples: number; data: string; rev: number }>();
  private relays = new Map<string, Heartbeat & { lastSeen: number }>();
  private rev = 0;

  async upsertRows(sessionKey: number, rows: LiveRowWrite[]) {
    let changed = 0;
    for (const r of newestPerRecord(rows)) {
      const id = `${sessionKey}|${r.topic}|${r.key}`;
      const old = this.rows.get(id);
      const replace =
        !old ||
        (r.msg_id !== null && (old.msgId === null || r.msg_id > old.msgId)) ||
        (r.msg_id === null && old.msgId === null && JSON.stringify(old.payload) !== JSON.stringify(r.payload)) ||
        (r.msg_id === null && old.msgId !== null && setFields(r.payload) > setFields(old.payload));
      if (replace) {
        this.rows.set(id, { sessionKey, topic: r.topic, key: r.key, msgId: r.msg_id ?? old?.msgId ?? null, payload: r.payload, rev: ++this.rev });
        changed++;
      }
    }
    return changed;
  }
  async putBuckets(sessionKey: number, buckets: StoredBucket[]) {
    let added = 0;
    for (const b of buckets) {
      const id = `${sessionKey}|${b.second}`;
      const old = this.buckets.get(id);
      if (old && b.samples <= old.samples) continue;
      this.buckets.set(id, { sessionKey, second: b.second, samples: b.samples, data: b.data, rev: ++this.rev });
      added++;
    }
    return added;
  }
  async rowsSince(sessionKey: number, rev: number) {
    return [...this.rows.values()]
      .filter((r) => r.sessionKey === sessionKey && r.rev > rev)
      .sort((a, b) => a.rev - b.rev)
      .slice(0, LIVE_PAGE)
      .map(({ topic, key, payload, rev: r }) => ({ topic, key, payload, rev: r }));
  }
  async bucketsSince(sessionKey: number, rev: number) {
    return [...this.buckets.values()]
      .filter((b) => b.sessionKey === sessionKey && b.rev > rev)
      .sort((a, b) => a.rev - b.rev)
      .slice(0, LIVE_PAGE)
      .map(({ second, data, rev: r }) => ({ second, data, rev: r }));
  }
  async bucketsBetween(sessionKey: number, from: number, to: number) {
    return [...this.buckets.values()].filter((b) => b.sessionKey === sessionKey && b.second >= from && b.second < to).sort((a, b) => a.second - b.second).map(({ second, data }) => ({ second, data }));
  }
  async status(sessionKey: number) {
    const buckets = [...this.buckets.values()].filter((b) => b.sessionKey === sessionKey);
    const seconds = buckets.map((b) => b.second);
    const revs = [...this.rows.values()].filter((r) => r.sessionKey === sessionKey).map((r) => r.rev);
    const relays = [...this.relays.values()].filter((r) => r.sessionKey === sessionKey);
    const lastSeen = relays.length ? Math.max(...relays.map((r) => r.lastSeen)) : null;
    return {
      firstSecond: seconds.length ? Math.min(...seconds) : null,
      lastSecond: seconds.length ? Math.max(...seconds) : null,
      lastRev: revs.length ? Math.max(...revs) : 0,
      lastBucketRev: buckets.length ? Math.max(...buckets.map((b) => b.rev)) : 0,
      relaysAlive: relays.filter((r) => r.lastSeen > Date.now() - 20_000 && !(r.note ?? "").startsWith("ended")).length,
      lastSeen: lastSeen === null ? null : new Date(lastSeen).toISOString(),
    };
  }
  async heartbeat(beat: Heartbeat) {
    this.relays.set(beat.relayId, { ...beat, lastSeen: Date.now() });
  }
  async sessionNow() {
    return null; // no calendar without Supabase; start relays with ?session=<key>
  }
  async clear(sessionKey: number) {
    for (const [id, r] of this.rows) if (r.sessionKey === sessionKey) this.rows.delete(id);
    for (const [id, b] of this.buckets) if (b.sessionKey === sessionKey) this.buckets.delete(id);
    for (const [id, r] of this.relays) if (r.sessionKey === sessionKey) this.relays.delete(id);
  }
}

const g = globalThis as { __liveMemoryStore?: MemoryLiveStore };

export function liveStore(): LiveStore {
  if (supabaseConfigured() && process.env.LIVE_STORE !== "memory") return new SupabaseLiveStore();
  return (g.__liveMemoryStore ??= new MemoryLiveStore());
}

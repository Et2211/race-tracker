import "server-only";
import { randomUUID } from "node:crypto";
import mqtt from "mqtt";
import { accessToken, openf1Credentials } from "@/lib/openf1/auth";
import { openf1, TooMuchDataError } from "@/lib/openf1/client";
import type { CarDataRow, LocationRow } from "@/lib/openf1/types";
import { BucketCollector, bucketsFromRows, encodeBucket } from "./buckets";
import type { LiveRowWrite, LiveStore } from "./store";
import { isRowTopic, isTelemetryTopic, ROW_TOPICS, rowKey, stripFeedFields, TELEMETRY_TOPICS, topicOf } from "./topics";

/**
 * One relay: holds a connection to OpenF1's real-time feed for `durationMs` and writes what it
 * receives to the live store. Relays start every minute and overlap, so each one only needs to
 * be right about what it saw; the store keeps one copy of everything.
 */
export const MQTT_URL = process.env.OPENF1_MQTT_URL ?? "wss://mqtt.openf1.org:8084/mqtt";
/** How far back a relay fills a gap it finds (nobody connected) from REST. Older gaps wait for the normal download. */
const CATCH_UP_MAX_S = 10 * 60;

export type RelayReport = { relayId: string; sessionKey: number; messages: number; rows: number; buckets: number; caughtUp: { from: number; to: number } | null; error: string | null };

export async function runRelay({ sessionKey, durationMs, store, log = () => {} }: { sessionKey: number; durationMs: number; store: LiveStore; log?: (line: string) => void }): Promise<RelayReport> {
  const credentials = openf1Credentials();
  const token = await accessToken();
  if (!credentials || !token) throw new Error("OpenF1 credentials are not set");

  const relayId = randomUUID();
  const report: RelayReport = { relayId, sessionKey, messages: 0, rows: 0, buckets: 0, caughtUp: null, error: null };
  const deadline = Date.now() + durationMs;
  const before = await store.status(sessionKey);
  const collector = new BucketCollector();
  const pending = new Map<string, LiveRowWrite>();
  let latest = 0; // newest telemetry sample time seen, epoch ms
  let subscribedAt: string | null = null;

  const client = await mqtt.connectAsync(MQTT_URL, {
    username: credentials.username,
    password: token,
    clientId: `race-tracker-${relayId.slice(0, 8)}`,
    clean: true,
    connectTimeout: 15_000,
    reconnectPeriod: 2_000,
  });
  client.on("message", (mqttTopic, buf) => {
    report.messages++;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
    } catch {
      return;
    }
    if (row.session_key !== undefined && row.session_key !== sessionKey) return;
    const topic = topicOf(mqttTopic);
    if (isTelemetryTopic(topic)) {
      if (typeof row.date !== "string") return;
      const sample = stripFeedFields(row) as unknown as LocationRow | CarDataRow;
      collector.add(topic, sample);
      latest = Math.max(latest, Date.parse(row.date));
    } else if (isRowTopic(topic)) {
      const key = rowKey(topic, row);
      if (!key) return;
      const msgId = typeof row._id === "number" ? row._id : null;
      const id = `${topic}|${key}`;
      const prev = pending.get(id);
      if (!prev || msgId === null || prev.msg_id === null || msgId > prev.msg_id) pending.set(id, { topic, key, msg_id: msgId, payload: stripFeedFields(row) });
    }
  });
  client.on("error", (e) => log(`mqtt error: ${e.message}`));

  try {
    await client.subscribeAsync([...ROW_TOPICS, ...TELEMETRY_TOPICS].map((t) => `v1/${t}`), { qos: 0 });
    subscribedAt = new Date().toISOString();
    await store.heartbeat({ relayId, sessionKey, subscribedAt, messages: 0, note: "subscribed" });

    // Nobody was connected just before this relay: fill the gap from REST once this relay knows
    // where its own complete seconds begin.
    const needsCatchUp = before.relaysAlive === 0;
    let catchUp: Promise<void> | null = null;

    let lastBeat = Date.now();
    while (Date.now() < deadline) {
      await sleep(1000);
      report.rows += await flushRows(store, sessionKey, pending);
      report.buckets += await store.putBuckets(sessionKey, collector.takeClosed(latest).map(encodeBucket));
      if (needsCatchUp && !catchUp && collector.start !== null) {
        const to = collector.start;
        const from = Math.max(before.lastSecond !== null ? before.lastSecond + 1 : to - CATCH_UP_MAX_S, to - CATCH_UP_MAX_S);
        catchUp = fillGap(store, sessionKey, from, to)
          .then((n) => {
            report.caughtUp = { from, to };
            report.buckets += n;
            log(`caught up ${to - from} s from REST`);
          })
          .catch((e) => log(`catch-up failed: ${e instanceof Error ? e.message : e}`));
      }
      if (Date.now() - lastBeat >= 5000) {
        await store.heartbeat({ relayId, sessionKey, subscribedAt, messages: report.messages });
        lastBeat = Date.now();
      }
    }
    report.rows += await flushRows(store, sessionKey, pending);
    report.buckets += await store.putBuckets(sessionKey, collector.takeClosed(latest).map(encodeBucket));
    if (catchUp) await catchUp;
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
    log(`relay failed: ${report.error}`);
  } finally {
    await client.endAsync().catch(() => undefined);
    await store.heartbeat({ relayId, sessionKey, subscribedAt, messages: report.messages, note: report.error ? `ended: ${report.error}` : "ended" }).catch(() => undefined);
  }
  return report;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function flushRows(store: LiveStore, sessionKey: number, pending: Map<string, LiveRowWrite>): Promise<number> {
  if (pending.size === 0) return 0;
  const rows = [...pending.values()];
  pending.clear();
  return store.upsertRows(sessionKey, rows);
}

async function restRange<T>(endpoint: string, sessionKey: number, from: number, to: number, depth = 0): Promise<T[]> {
  try {
    return await openf1<T>(endpoint, { session_key: sessionKey, "date>=": new Date(from * 1000).toISOString(), "date<": new Date(to * 1000).toISOString() });
  } catch (e) {
    if (!(e instanceof TooMuchDataError) || depth >= 4 || to - from < 2) throw e;
    const mid = Math.floor((from + to) / 2);
    return [...(await restRange<T>(endpoint, sessionKey, from, mid, depth + 1)), ...(await restRange<T>(endpoint, sessionKey, mid, to, depth + 1))];
  }
}

/** Fills seconds [from, to) of telemetry and refreshes the low-rate topics from REST. */
async function fillGap(store: LiveStore, sessionKey: number, from: number, to: number): Promise<number> {
  let added = 0;
  if (to > from) {
    const [location, carData] = [await restRange<LocationRow>("location", sessionKey, from, to), await restRange<CarDataRow>("car_data", sessionKey, from, to)];
    added = await store.putBuckets(sessionKey, bucketsFromRows(location, carData).map(encodeBucket));
  }
  // Records have no _id over REST: they only fill rows the feed has not delivered.
  for (const topic of ROW_TOPICS) {
    const rows = await openf1<Record<string, unknown>>(topic, { session_key: sessionKey });
    const writes = rows.flatMap((row): LiveRowWrite[] => {
      const key = rowKey(topic, row);
      return key ? [{ topic, key, msg_id: null, payload: row }] : [];
    });
    await store.upsertRows(sessionKey, writes);
  }
  return added;
}

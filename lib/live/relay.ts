import "server-only";
import { randomUUID } from "node:crypto";
import mqtt from "mqtt";
import { accessToken, openf1Credentials } from "@/lib/openf1/auth";
import { openf1, TooMuchDataError } from "@/lib/openf1/client";
import type { CarDataRow, LocationRow } from "@/lib/openf1/types";
import { BucketCollector, bucketsFromRows, encodeBucket, type StoredBucket } from "./buckets";
import type { LiveRowWrite, LiveStore } from "./store";
import { isRowTopic, isTelemetryTopic, ROW_TOPICS, rowKey, stripFeedFields, TELEMETRY_TOPICS, topicOf } from "./topics";

/**
 * One relay: holds a connection to OpenF1's real-time feed for `durationMs` and writes what it
 * receives to the live store. Relays start every minute and overlap, so each one only needs to
 * be right about what it saw; the store keeps one copy of everything.
 */
/**
 * Where to connect, in order. OpenF1 (https://openf1.org/auth.html) recommends plain MQTT over
 * TLS for backends, keeping MQTT over WebSocket for browsers; WebSocket stays as the fallback in
 * case a host blocks port 8883. OPENF1_MQTT_URL names a single address instead (the local fake).
 */
export const MQTT_URLS = process.env.OPENF1_MQTT_URL ? [process.env.OPENF1_MQTT_URL] : ["mqtts://mqtt.openf1.org:8883", "wss://mqtt.openf1.org:8084/mqtt"];

/** Connects to the first address that answers; each gets `timeoutMs`. */
export async function connectFeed(options: mqtt.IClientOptions, timeoutMs = 10_000, log: (line: string) => void = () => {}, urls: string[] = MQTT_URLS): Promise<{ client: mqtt.MqttClient; url: string }> {
  let last: unknown = null;
  for (const url of urls) {
    try {
      return { client: await mqtt.connectAsync(url, { ...options, connectTimeout: timeoutMs }), url };
    } catch (e) {
      last = e;
      const err = e as { message?: string; code?: string };
      log(`could not connect to ${url}: ${[err.code, err.message].filter(Boolean).join(" ") || String(e)}`);
    }
  }
  throw last instanceof Error ? last : new Error("Could not connect to the live feed");
}
/** How far back a relay fills a gap it finds (nobody connected) from REST. Older gaps wait for the normal download. */
const CATCH_UP_MAX_S = 10 * 60;

export type RelayReport = { relayId: string; sessionKey: number; via: string | null; messages: number; rows: number; buckets: number; caughtUp: { from: number; to: number } | null; error: string | null };

/** Stored data older than this when a relay starts means nobody was relaying: fill the gap from REST. */
const STALE_S = 15;

export async function runRelay({ sessionKey, durationMs, store, log = () => {} }: { sessionKey: number; durationMs: number; store: LiveStore; log?: (line: string) => void }): Promise<RelayReport> {
  const credentials = openf1Credentials();
  // Valid for the whole relay, so a reconnect near its end does not present an expired token.
  const token = await accessToken(durationMs + 60_000);
  if (!credentials || !token) throw new Error("OpenF1 credentials are not set");

  const relayId = randomUUID();
  const report: RelayReport = { relayId, sessionKey, via: null, messages: 0, rows: 0, buckets: 0, caughtUp: null, error: null };
  const deadline = Date.now() + durationMs;
  const before = await store.status(sessionKey);
  const collector = new BucketCollector();
  const pending = new Map<string, LiveRowWrite>();
  let unsaved: StoredBucket[] = []; // closed seconds whose write failed, retried next time round
  let subscribedAt: string | null = null;

  const { client, url } = await connectFeed(
    { username: credentials.username, password: token, clientId: `race-tracker-${relayId.slice(0, 8)}`, clean: true, reconnectPeriod: 2_000 },
    10_000,
    log,
  );
  report.via = url;
  // Before reconnecting, make sure the password is a current token.
  client.on("offline", () => {
    accessToken(Math.max(60_000, deadline - Date.now() + 60_000))
      .then((t) => {
        if (t) client.options.password = t;
      })
      .catch((e: unknown) => log(`token renewal failed: ${e instanceof Error ? e.message : e}`));
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
      collector.add(topic, stripFeedFields(row) as unknown as LocationRow | CarDataRow);
    } else if (isRowTopic(topic)) {
      const key = rowKey(topic, row);
      if (!key) return;
      const msgId = typeof row._id === "number" ? row._id : null;
      keepNewest(pending, { topic, key, msg_id: msgId, payload: stripFeedFields(row) });
    }
  });
  client.on("error", (e) => log(`mqtt error: ${e.message}`));

  /** Writes what has arrived; a failed write keeps its rows and seconds for the next attempt. */
  const flush = async () => {
    if (pending.size) {
      const rows = [...pending.values()];
      pending.clear();
      try {
        report.rows += await store.upsertRows(sessionKey, rows);
      } catch (e) {
        for (const r of rows) keepNewest(pending, r, true);
        log(`saving rows failed, will retry: ${e instanceof Error ? e.message : e}`);
      }
    }
    const buckets = [...unsaved, ...collector.takeClosed().map(encodeBucket)];
    unsaved = [];
    if (buckets.length) {
      try {
        report.buckets += await store.putBuckets(sessionKey, buckets);
      } catch (e) {
        unsaved = buckets;
        log(`saving car data failed, will retry: ${e instanceof Error ? e.message : e}`);
      }
    }
  };

  try {
    await client.subscribeAsync([...ROW_TOPICS, ...TELEMETRY_TOPICS].map((t) => `v1/${t}`), { qos: 0 });
    subscribedAt = new Date().toISOString();
    collector.setSubscribed(Date.now());
    await store.heartbeat({ relayId, sessionKey, subscribedAt, messages: 0, note: "subscribed" }).catch(() => undefined);

    // Nobody was relaying just before this one (none alive, or the newest stored second is old):
    // fill the gap from REST once this relay knows where its own complete seconds begin.
    const stale = before.lastSecond === null || Date.now() / 1000 - before.lastSecond > STALE_S;
    const needsCatchUp = before.relaysAlive === 0 || stale;
    let catchUp: Promise<boolean> | null = null;
    let attempts = 0;
    let nextAttempt = 0;

    let lastBeat = Date.now();
    while (Date.now() < deadline) {
      await sleep(1000);
      await flush();
      const start = collector.start;
      if (needsCatchUp && !catchUp && start !== null && attempts < 3 && Date.now() >= nextAttempt) {
        attempts++;
        const to = start;
        const from = Math.max(before.lastSecond !== null ? before.lastSecond + 1 : to - CATCH_UP_MAX_S, to - CATCH_UP_MAX_S);
        catchUp = fillGap(store, sessionKey, from, to, log).then(({ buckets, complete }) => {
          report.buckets += buckets;
          if (complete) {
            report.caughtUp = { from, to };
            log(`caught up ${to - from} s from REST`);
          }
          return complete;
        });
        catchUp.then((complete) => {
          if (!complete) {
            catchUp = null; // try again in 10 s
            nextAttempt = Date.now() + 10_000;
          }
        });
      }
      if (Date.now() - lastBeat >= 5000) {
        await store.heartbeat({ relayId, sessionKey, subscribedAt, messages: report.messages }).catch(() => undefined);
        lastBeat = Date.now();
      }
    }
    await flush();
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

/** Keeps one pending write per record: the newest feed version (or, when putting back, never one older than what is waiting). */
function keepNewest(pending: Map<string, LiveRowWrite>, row: LiveRowWrite, putBack = false) {
  const id = `${row.topic}|${row.key}`;
  const prev = pending.get(id);
  if (!prev) pending.set(id, row);
  else if (putBack) return; // a newer version arrived while the write was failing
  else if (row.msg_id === null || prev.msg_id === null || row.msg_id > prev.msg_id) pending.set(id, row);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function restRange<T>(endpoint: string, sessionKey: number, from: number, to: number, depth = 0): Promise<T[]> {
  try {
    return await openf1<T>(endpoint, { session_key: sessionKey, "date>=": new Date(from * 1000).toISOString(), "date<": new Date(to * 1000).toISOString() });
  } catch (e) {
    if (!(e instanceof TooMuchDataError) || depth >= 4 || to - from < 2) throw e;
    const mid = Math.floor((from + to) / 2);
    return [...(await restRange<T>(endpoint, sessionKey, from, mid, depth + 1)), ...(await restRange<T>(endpoint, sessionKey, mid, to, depth + 1))];
  }
}

/** Fills seconds [from, to) of car data and refreshes the low-rate topics from REST; `complete` is false if any part failed. */
async function fillGap(store: LiveStore, sessionKey: number, from: number, to: number, log: (line: string) => void): Promise<{ buckets: number; complete: boolean }> {
  let buckets = 0;
  let complete = true;
  if (to > from) {
    try {
      const location = await restRange<LocationRow>("location", sessionKey, from, to);
      const carData = await restRange<CarDataRow>("car_data", sessionKey, from, to);
      buckets = await store.putBuckets(sessionKey, bucketsFromRows(location, carData).map(encodeBucket));
    } catch (e) {
      complete = false;
      log(`catch-up of car data failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  // Records have no _id over REST: they fill rows the feed has not delivered, or fields it has not.
  for (const topic of ROW_TOPICS) {
    try {
      const rows = await openf1<Record<string, unknown>>(topic, { session_key: sessionKey });
      const writes = rows.flatMap((row): LiveRowWrite[] => {
        const key = rowKey(topic, row);
        return key ? [{ topic, key, msg_id: null, payload: row }] : [];
      });
      await store.upsertRows(sessionKey, writes);
    } catch (e) {
      complete = false;
      log(`catch-up of ${topic} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { buckets, complete };
}

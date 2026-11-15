/**
 * Live mode, end to end without an account or network: the fake OpenF1 replays the recorded
 * Madrid race (the lap-14 window) in real time. Three relays connect overlapping like the cron
 * job starts them; then nobody is connected for 20 s; then a fourth relay starts and must fill
 * that gap from REST. Meanwhile a viewer polls the store once a second as the browser does.
 * Checked against the source:
 *   - no second of car data with samples in the source is missing (hand-overs and the gap),
 *   - every stored second holds exactly the source's samples (nothing dropped or doubled),
 *   - every lap finished during the run is stored once, in its final version,
 *   - the viewer ends up with exactly what is stored, including seconds filled in behind it.
 *
 *   npm run test:live                          (~100 s, in memory)
 *   TEST_LIVE_SUPABASE=1 npm run test:live     (against Supabase per .env.local; clears its rows after)
 */
import { spawn } from "node:child_process";
import nextEnv from "@next/env";

const SUPABASE = process.env.TEST_LIVE_SUPABASE === "1";
if (SUPABASE) nextEnv.loadEnvConfig(process.cwd());

const PORT = 4110;
const base = `http://localhost:${PORT}`;
Object.assign(process.env, {
  OPENF1_API_BASE: `${base}/v1`,
  // The fake's TCP listener: its WebSocket one does not work on Node 26 (an aedes problem). The
  // relay code is the same either way; the WebSocket transport is checked against the real
  // broker by `npm run live:check`.
  OPENF1_MQTT_URL: `mqtt://localhost:${PORT + 1}`,
  OPENF1_USERNAME: "fake",
  OPENF1_PASSWORD: "fake",
  LIVE_STORE: SUPABASE ? "" : "memory",
});
if (!SUPABASE) delete process.env.SUPABASE_URL;

const fake = spawn("npx", ["tsx", "--tsconfig", "scripts/tsconfig.json", "scripts/fake-openf1.mts", "--fixtures", "--session", "11369", "--at", "2026-09-13T13:26:35Z", "--port", String(PORT)], {
  env: { ...process.env, SUPABASE_URL: "" },
  stdio: ["ignore", "pipe", "inherit"],
  detached: true, // its own process group, so stopping it also stops the tsx child holding the port
});
const stopFake = () => {
  try {
    process.kill(-fake.pid!, "SIGTERM");
  } catch {
    fake.kill();
  }
};
await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("the fake OpenF1 did not start")), 60_000);
  fake.stdout!.on("data", (d: Buffer) => {
    if (d.toString().includes("fake OpenF1 on")) {
      clearTimeout(timer);
      resolve();
    }
  });
});

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

try {
  const { runRelay } = await import("@/lib/live/relay");
  const { liveStore } = await import("@/lib/live/store");
  const { decodeBucket } = await import("@/lib/live/buckets");
  const { accessToken } = await import("@/lib/openf1/auth");
  const { LIVE_PAGE } = await import("@/lib/live/store");
  const store = liveStore();
  const SESSION = 11369;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Three relays, 25 s each, started 12 s apart: always at least one connected, hand-overs overlap.
  // TEST_RELAY_MS shortens them, to check this test notices gaps between relays.
  const RELAY_MS = Number(process.env.TEST_RELAY_MS ?? 25_000);
  const started = Date.now();

  // A viewer, reading "changed since" as the live endpoints do.
  const viewer = { rows: new Map<string, string>(), seconds: new Map<number, string>(), rowRev: 0, bucketRev: 0 };
  const poll = async () => {
    for (;;) {
      const page = await store.rowsSince(SESSION, viewer.rowRev);
      for (const r of page) viewer.rows.set(`${r.topic}|${r.key}`, JSON.stringify(r.payload));
      if (page.length) viewer.rowRev = page[page.length - 1].rev;
      if (page.length < LIVE_PAGE) break;
    }
    for (;;) {
      const page = await store.bucketsSince(SESSION, viewer.bucketRev);
      for (const b of page) viewer.seconds.set(b.second, b.data);
      if (page.length) viewer.bucketRev = page[page.length - 1].rev;
      if (page.length < LIVE_PAGE) break;
    }
  };
  const viewing = setInterval(() => void poll(), 1000);

  const relay = (at: number, ms: number) => async () => {
    await sleep(at);
    return runRelay({ sessionKey: SESSION, durationMs: ms, store, log: (l) => console.log(`  relay@${at / 1000}s: ${l}`) });
  };
  const reports = await Promise.all([relay(0, RELAY_MS)(), relay(12_000, RELAY_MS)(), relay(24_000, RELAY_MS)()]);
  // Nobody connected for 20 s; then a relay that must notice and fill the gap.
  const gapFrom = Math.floor(Date.now() / 1000);
  reports.push(await relay(20_000, 20_000)());
  check(reports.at(-1)!.caughtUp !== null && reports.at(-1)!.caughtUp!.from <= gapFrom, "the relay after a gap filled it from REST");
  clearInterval(viewing);
  await poll();
  console.log(`relays ran for ${Math.round((Date.now() - started) / 1000)} s; messages: ${reports.map((r) => r.messages).join(", ")}`);
  check(reports.every((r) => r.error === null), "every relay ended without an error");

  // Car data: compare each stored second with the source.
  const status = await store.status(SESSION);
  check(status.firstSecond !== null && status.lastSecond !== null, `car data was stored (${status.lastSecond !== null && status.firstSecond !== null ? status.lastSecond - status.firstSecond + 1 : 0} seconds spanned)`);
  const token = await accessToken();
  const rest = async <T,>(endpoint: string, query: string): Promise<T[]> => {
    const res = await fetch(`${base}/v1/${endpoint}?session_key=${SESSION}${query}`, { headers: { Authorization: `Bearer ${token}` } });
    return res.status === 404 ? [] : ((await res.json()) as T[]);
  };
  const from = new Date(status.firstSecond! * 1000).toISOString();
  const to = new Date((status.lastSecond! + 1) * 1000).toISOString();
  const source = new Map<number, number>();
  for (const endpoint of ["location", "car_data"]) {
    for (const row of await rest<{ date: string }>(endpoint, `&date>=${from}&date<${to}`)) {
      const s = Math.floor(Date.parse(row.date) / 1000);
      source.set(s, (source.get(s) ?? 0) + 1);
    }
  }
  const stored = new Map((await store.bucketsBetween(SESSION, status.firstSecond!, status.lastSecond! + 1)).map((b) => [b.second, b]));
  const missing = [...source.keys()].filter((s) => !stored.has(s));
  check(missing.length === 0, `no second of car data missing (${source.size} seconds in the source, ${missing.length} missing${missing.length ? `: ${missing.slice(0, 5).map((s) => new Date(s * 1000).toISOString().slice(11, 19)).join(", ")}` : ""})`);
  let wrong = 0;
  for (const [s, b] of stored) {
    const d = decodeBucket(s, b.data);
    if (d.location.length + d.carData.length !== (source.get(s) ?? 0)) wrong++;
  }
  check(wrong === 0, `every stored second holds exactly the source's samples (${wrong} of ${stored.size} differ)`);

  // The viewer saw everything, including seconds filled in behind its cursor.
  const allStored = await store.bucketsBetween(SESSION, status.firstSecond!, status.lastSecond! + 1);
  const viewerMissing = allStored.filter((b) => viewer.seconds.get(b.second) !== b.data).length;
  check(viewerMissing === 0, `the viewer received every stored second in its final version (${allStored.length} seconds, ${viewerMissing} missing or stale)`);

  // Laps: each finished lap once, final version.
  const rows = [];
  for (let rev = 0; ; ) {
    const page = await store.rowsSince(SESSION, rev);
    rows.push(...page);
    if (page.length === 0) break;
    rev = page[page.length - 1].rev;
  }
  const viewerStale = rows.filter((r) => viewer.rows.get(`${r.topic}|${r.key}`) !== JSON.stringify(r.payload)).length;
  check(viewerStale === 0, `the viewer received every stored record in its final version (${rows.length} records, ${viewerStale} missing or stale)`);
  const laps = rows.filter((r) => r.topic === "laps");
  check(new Set(laps.map((r) => r.key)).size === laps.length, `each lap stored once (${laps.length} laps)`);
  const sourceLaps = await rest<{ driver_number: number; lap_number: number; date_start: string; lap_duration: number | null }>("laps", "");
  const cutoff = Date.now() - 6_000; // finished comfortably before the last relay stopped
  const finished = sourceLaps.filter((l) => l.lap_duration !== null && Date.parse(l.date_start) + l.lap_duration * 1000 < cutoff && Date.parse(l.date_start) + l.lap_duration * 1000 > started);
  const byKey = new Map(laps.map((r) => [r.key, r.payload as { lap_duration: number | null }]));
  const stale = finished.filter((l) => byKey.get(`${l.driver_number}|${l.lap_number}`)?.lap_duration !== l.lap_duration);
  check(finished.length > 0 && stale.length === 0, `laps finished during the test are stored in their final version (${finished.length} laps, ${stale.length} stale)`);
} catch (e) {
  failures.push(e instanceof Error ? e.message : String(e));
  console.error(e);
} finally {
  if (SUPABASE) {
    const { liveStore } = await import("@/lib/live/store");
    await liveStore().clear(11369).catch((e: unknown) => console.error("could not clear the test rows", e));
  }
  stopFake();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nlive mode: all checks passed");
process.exit(failures.length ? 1 : 0);

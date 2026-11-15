/**
 * Live mode, end to end without an account or network: the fake OpenF1 replays the recorded
 * Madrid race (the lap-14 window) in real time, three relays connect overlapping like the cron
 * job starts them, and what they stored is compared with the source:
 *   - no second of car data with samples in the source is missing (hand-overs lose nothing),
 *   - every stored second holds exactly the source's samples (nothing dropped or doubled),
 *   - every lap finished before the last relay stopped is stored once, in its final version.
 *
 *   npm run test:live        (~70 s)
 */
import { spawn } from "node:child_process";

const PORT = 4110;
const base = `http://localhost:${PORT}`;
Object.assign(process.env, {
  OPENF1_API_BASE: `${base}/v1`,
  OPENF1_MQTT_URL: `ws://localhost:${PORT}/mqtt`,
  OPENF1_USERNAME: "fake",
  OPENF1_PASSWORD: "fake",
  LIVE_STORE: "memory",
});
delete process.env.SUPABASE_URL;

const fake = spawn("npx", ["tsx", "--tsconfig", "scripts/tsconfig.json", "scripts/fake-openf1.mts", "--fixtures", "--session", "11369", "--at", "2026-09-13T13:26:35Z", "--port", String(PORT)], {
  env: { ...process.env, SUPABASE_URL: "" },
  stdio: ["ignore", "pipe", "inherit"],
});
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
  const store = liveStore();
  const SESSION = 11369;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Three relays, 25 s each, started 12 s apart: always at least one connected, hand-overs overlap.
  // TEST_RELAY_MS shortens them, to check this test notices gaps between relays.
  const RELAY_MS = Number(process.env.TEST_RELAY_MS ?? 25_000);
  const started = Date.now();
  const relays = [0, 12_000, 24_000].map(async (at) => {
    await sleep(at);
    return runRelay({ sessionKey: SESSION, durationMs: RELAY_MS, store, log: (l) => console.log(`  relay@${at / 1000}s: ${l}`) });
  });
  const reports = await Promise.all(relays);
  console.log(`relays ran for ${Math.round((Date.now() - started) / 1000)} s; messages: ${reports.map((r) => r.messages).join(", ")}`);
  check(reports.every((r) => r.error === null), "every relay ended without an error");

  // Car data: compare each stored second with the source.
  const status = await store.status(SESSION);
  check(status.firstSecond !== null && status.lastSecond !== null, `car data was stored (${status.buckets} seconds)`);
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

  // Laps: each finished lap once, final version.
  const rows = [];
  for (let rev = 0; ; ) {
    const page = await store.rowsSince(SESSION, rev);
    rows.push(...page);
    if (page.length === 0) break;
    rev = page[page.length - 1].rev;
  }
  const laps = rows.filter((r) => r.topic === "laps");
  check(new Set(laps.map((r) => r.key)).size === laps.length, `each lap stored once (${laps.length} laps)`);
  const sourceLaps = await rest<{ driver_number: number; lap_number: number; date_start: string; lap_duration: number | null }>("laps", "");
  const cutoff = started + 24_000 + RELAY_MS - 6_000; // finished comfortably before the last relay stopped
  const finished = sourceLaps.filter((l) => l.lap_duration !== null && Date.parse(l.date_start) + l.lap_duration * 1000 < cutoff && Date.parse(l.date_start) + l.lap_duration * 1000 > started);
  const byKey = new Map(laps.map((r) => [r.key, r.payload as { lap_duration: number | null }]));
  const stale = finished.filter((l) => byKey.get(`${l.driver_number}|${l.lap_number}`)?.lap_duration !== l.lap_duration);
  check(finished.length > 0 && stale.length === 0, `laps finished during the test are stored in their final version (${finished.length} laps, ${stale.length} stale)`);
} catch (e) {
  failures.push(e instanceof Error ? e.message : String(e));
  console.error(e);
} finally {
  fake.kill();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nlive mode: all checks passed");
process.exit(failures.length ? 1 : 0);

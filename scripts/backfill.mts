/**
 * Fill in what the homepage needs for sessions that were stored before it existed.
 *
 *   npm run backfill                    # summaries and circuit outlines for every stored session (no OpenF1 calls)
 *   npm run backfill -- --standings     # also championship standings after each race and sprint, 2023 onwards
 *   npm run backfill -- --stints        # also tyre stints for stored races and sprints (1 OpenF1 request each)
 *
 * Uses the same store as the app (Supabase when SUPABASE_URL and SUPABASE_SECRET_KEY are set in
 * .env.local, otherwise .cache/store). Safe to re-run: anything already there is skipped.
 * Run standings on their own, not while another download is using OpenF1's request allowance.
 */
import nextEnv from "@next/env"; // CommonJS: no named exports in ES modules

nextEnv.loadEnvConfig(process.cwd());

const { sessionIndex } = await import("@/lib/storage/session-index");
const { getStore, readJson, writeJson } = await import("@/lib/storage/store");
const { openf1 } = await import("@/lib/openf1/client");
type Stint = import("@/lib/openf1/types").Stint;
const { metaKey, summaryKey, writeDerived } = await import("@/lib/session/ingest");
const { cachedStandings, standingsAfter } = await import("@/lib/session/championship");
const { getCatalog } = await import("@/lib/session/source");
const { FIRST_YEAR } = await import("@/lib/session/catalog");
type SessionMeta = import("@/lib/session/types").SessionMeta;

const index = sessionIndex();
const stored = [...(await index.complete())].sort((a, b) => a - b);
console.log(`${stored.length} stored sessions`);

let written = 0;
for (const key of stored) {
  if (await readJson(summaryKey(key))) continue;
  const meta = await readJson<SessionMeta>(metaKey(key));
  if (!meta) {
    console.log(`${key}: no metadata, skipped`);
    continue;
  }
  const bytes = await writeDerived(meta);
  await index.added(key, bytes, false);
  written++;
  console.log(`${key} ${meta.meeting.meeting_name} ${meta.session.session_name}: summary${meta.outline ? " and outline" : ""}`);
}
console.log(`summaries written: ${written}`);

if (process.argv.includes("--stints")) {
  let added = 0;
  for (const key of stored) {
    const meta = await readJson<SessionMeta>(metaKey(key));
    if (!meta || meta.kind !== "race" || meta.stints) continue;
    const before = (await getStore().getRaw(metaKey(key)))?.length ?? 0;
    meta.stints = await openf1<Stint>("stints", { session_key: key });
    const after = await writeJson(metaKey(key), meta);
    await index.added(key, after - before, false);
    added++;
    console.log(`${key} ${meta.meeting.meeting_name} ${meta.session.session_name}: ${meta.stints.length} stints`);
  }
  console.log(`stints added: ${added}`);
}

if (process.argv.includes("--standings")) {
  const now = Date.now();
  for (let year = FIRST_YEAR; year <= new Date().getUTCFullYear(); year++) {
    const catalog = await getCatalog(year);
    for (const m of catalog.meetings) {
      for (const s of m.sessions) {
        if ((s.name !== "Race" && s.name !== "Sprint") || !s.available || Date.parse(s.dateEnd) > now) continue;
        if ((await cachedStandings(s.sessionKey))?.people) continue;
        const standings = await standingsAfter(s.sessionKey, s.dateEnd).catch((e: unknown) => {
          console.log(`${s.sessionKey} ${m.name} ${s.name}: FAILED ${e instanceof Error ? e.message : e}`);
          return null;
        });
        if (standings) console.log(`${s.sessionKey} ${m.name} ${s.name}: standings, ${standings.drivers.length} drivers`);
      }
    }
  }
}
console.log("BACKFILL DONE");

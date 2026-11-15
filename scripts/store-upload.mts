/**
 * Upload sessions already downloaded to the local disk store (.cache/store) into Supabase, so
 * they do not have to be fetched from OpenF1 again. Needs SUPABASE_URL and SUPABASE_SECRET_KEY
 * (read from .env.local). Skips sessions Supabase already has.
 *
 *   npm run store:upload                # every complete local session
 *   npm run store:upload -- 11369 11412 # only these
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import nextEnv from "@next/env"; // CommonJS: no named exports in ES modules
import { createClient } from "@supabase/supabase-js";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ROOT = process.env.STORE_DIR ?? path.join(process.cwd(), ".cache", "store", "sessions");
const CAP = Number(process.env.STORE_CAP_MB ?? 900) * 1024 * 1024;

const wanted = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
const keys = (wanted.length ? wanted : readdirSync(ROOT)).filter((k) => /^\d+$/.test(k));
const { data: existing, error: e0 } = await db.from("stored_sessions").select("session_key, bytes");
if (e0) throw e0;
let used = existing.reduce((sum, r) => sum + Number(r.bytes), 0);
const have = new Set(existing.map((r) => r.session_key as number));

for (const key of keys) {
  const dir = path.join(ROOT, key);
  if (have.has(Number(key))) {
    console.log(`${key}: already in Supabase`);
    continue;
  }
  const metaGz = readFileSync(path.join(dir, "meta.json.gz"));
  const meta = JSON.parse(gunzipSync(metaGz).toString("utf8"));
  const chunks = meta.windows.map((w: { index: number }) => path.join(dir, `chunk-${w.index}.json.gz`));
  let files: [string, Buffer][];
  try {
    files = [[`sessions/${key}/meta.json.gz`, metaGz], ...chunks.map((f: string, i: number) => [`sessions/${key}/chunk-${i}.json.gz`, readFileSync(f)] as [string, Buffer])];
  } catch {
    console.log(`${key}: not every window is downloaded locally; skipped`);
    continue;
  }
  const bytes = files.reduce((sum, [, b]) => sum + b.length, 0);
  if (used + bytes > CAP) {
    console.log(`${key}: would pass the ${Math.round(CAP / 1048576)} MB cap; stopping`);
    break;
  }
  for (const [name, body] of files) {
    const { error } = await db.storage.from("sessions").upload(name, body, { contentType: "application/gzip", upsert: true });
    if (error) throw new Error(`${name}: ${error.message}`);
  }
  const { error } = await db.from("stored_sessions").upsert({
    session_key: Number(key),
    year: meta.session.year,
    meeting_name: meta.meeting.meeting_name,
    session_name: meta.session.session_name,
    circuit_key: meta.session.circuit_key,
    windows: meta.windows.length,
    windows_stored: meta.windows.length,
    bytes,
  });
  if (error) throw error;
  used += bytes;
  console.log(`${key} ${meta.meeting.meeting_name} ${meta.session.session_name}: ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB`);
}
console.log(`Supabase storage used by sessions: ${(used / 1048576).toFixed(0)} MB`);

/**
 * Ingest sessions into the store through a running server's API, one request at a time.
 *
 *   npm run ingest -- 11369 11412                 # by session key
 *   npm run ingest -- --year 2026 --type Race     # every race of a season (Race or Sprint ...)
 *
 * BASE_URL defaults to http://localhost:3000.
 */
import type { Catalog } from "@/lib/session/catalog";
import type { SessionMeta } from "@/lib/session/types";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function post<T>(url: string): Promise<T> {
  // The server returns the stored copy or downloads it first.
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

async function keys(): Promise<number[]> {
  const year = opt("--year");
  if (!year) return args.filter((a) => /^\d+$/.test(a)).map(Number);
  const types = (opt("--type") ?? "Race").split(",");
  const catalog = (await (await fetch(`${BASE}/api/catalog/${year}`)).json()) as Catalog;
  return catalog.meetings.flatMap((m) => m.sessions.filter((s) => s.available && types.includes(s.name)).map((s) => s.sessionKey));
}

for (const key of await keys()) {
  const t0 = Date.now();
  try {
    const meta = await post<SessionMeta>(`${BASE}/api/sessions/${key}/meta`);
    for (const w of meta.windows) await post(`${BASE}/api/sessions/${key}/chunks/${w.index}`);
    console.log(`${key} ${meta.meeting.meeting_name} ${meta.session.session_name}: ${meta.windows.length} windows, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  } catch (e) {
    console.log(`${key}: FAILED ${e instanceof Error ? e.message : e}`);
  }
}

import "server-only";
import { withDownloadLock } from "@/lib/storage/download-lock";
import { downloadLocks } from "@/lib/storage/locks";
import { sessionIndex } from "@/lib/storage/session-index";
import { getStore, writeJson } from "@/lib/storage/store";
import { supabase } from "@/lib/storage/supabase";
import { marshalSectors } from "./assemble";
import { SETTLE_MS } from "./catalog";
import { cachedStandings, standingsAfter } from "./championship";
import { learnedSectors, metaKey, multiviewerCircuit, storedSessionMeta } from "./ingest";

/** Jobs for the daily calendar run. Each is bounded and safe to repeat. */

type CalendarRow = { session_key: number; session_name: string; date_end: string; year: number };

async function calendarRows(fromIso: string, toIso: string): Promise<CalendarRow[]> {
  const { data, error } = await supabase()
    .from("session_calendar")
    .select("session_key, session_name, date_end, year")
    .eq("is_cancelled", false)
    .gte("date_end", fromIso)
    .lte("date_end", toIso)
    .order("date_end");
  if (error) throw error;
  return data as CalendarRow[];
}

/** Championship tables after this season's finished races and sprints that are not cached yet (3 OpenF1 requests each). */
export async function fillStandings(year: number): Promise<number> {
  const rows = await calendarRows(`${year}-01-01T00:00:00Z`, new Date(Date.now() - SETTLE_MS).toISOString());
  let filled = 0;
  for (const r of rows) {
    if ((r.session_name !== "Race" && r.session_name !== "Sprint") || (await cachedStandings(r.session_key))) continue;
    if (await standingsAfter(r.session_key, r.date_end).catch(() => null)) filled++;
  }
  return filled;
}

/** Live rows no longer needed: sessions since stored in full, and practice (live only) that ended over an hour ago. */
export async function clearDownloadedLive(): Promise<number> {
  const { data, error } = await supabase().rpc("live_clear_finished");
  if (error) throw error;
  return Number(data ?? 0);
}

/**
 * Sessions of the last two weeks stored without MultiViewer's circuit file (its server failed,
 * or the file appeared later): try again, and if it is there now, store the official marshal
 * sectors and rotation in the session's metadata. Done under the session's download lock, with
 * the stored size updated.
 */
export async function retryMultiViewer(): Promise<number[]> {
  const rows = await calendarRows(new Date(Date.now() - 14 * 86_400_000).toISOString(), new Date().toISOString());
  const stored = await sessionIndex().complete();
  const updated: number[] = [];
  for (const r of rows) {
    if (!stored.has(r.session_key)) continue;
    const meta = await storedSessionMeta(r.session_key);
    if (!meta || meta.marshal.source === "multiviewer" || !meta.meeting.circuit_info_url) continue;
    const mv = await multiviewerCircuit(meta.meeting).catch(() => null);
    if (!mv) continue;
    await withDownloadLock(
      downloadLocks(),
      `meta:${r.session_key}`,
      async () => null, // always (re)write; the lock only keeps a download from running at the same time
      async () => {
        const before = (await getStore().getRaw(metaKey(r.session_key)))?.length ?? 0;
        const patched = { ...meta, rotation: mv.rotation, marshal: marshalSectors(meta.outline, mv, await learnedSectors(meta.session.circuit_key), r.session_key) };
        const after = await writeJson(metaKey(r.session_key), patched);
        await sessionIndex().added(r.session_key, after - before, false);
        return patched;
      },
      { ttlSeconds: 60, waitMs: 30_000 },
    );
    updated.push(r.session_key);
  }
  return updated;
}

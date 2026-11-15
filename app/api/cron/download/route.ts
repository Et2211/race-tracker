import { connection } from "next/server";
import { dueSessions, recordAttempt } from "@/lib/session/calendar";
import { cronAuthorized } from "@/lib/session/cron-auth";
import { downloadSession } from "@/lib/session/download";
import { errorJson } from "@/lib/session/http";
import { supabaseConfigured } from "@/lib/storage/supabase";

export const maxDuration = 300;

/** Stop starting new work after this, to finish well inside the 300 s limit. */
const BUDGET_MS = 220_000;

/**
 * Called by the database job when `due_sessions()` returns anything: downloads due sessions,
 * oldest first, into the store. `?session=<key>` downloads one session regardless of the calendar.
 */
export async function GET(req: Request) {
  await connection();
  if (!cronAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!supabaseConfigured()) return Response.json({ error: "Supabase is not configured" }, { status: 503 });
  const started = Date.now();
  const only = new URL(req.url).searchParams.get("session");
  try {
    const due = only ? [{ session_key: Number(only), meeting_name: "", session_name: "", download_attempts: 0 }] : await dueSessions();
    const results = [];
    for (const s of due) {
      const left = BUDGET_MS - (Date.now() - started);
      if (left < 60_000) break; // not enough time to make progress; the next run carries on
      try {
        const r = await downloadSession(s.session_key, left);
        if (!only) await recordAttempt(s.session_key, s.download_attempts, r.complete ? null : `Stopped after ${r.stored} of ${r.windows} windows (time limit); continues next run`);
        results.push({ ...r, name: `${s.meeting_name} ${s.session_name}`.trim() });
        if (!r.complete) break;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!only) await recordAttempt(s.session_key, s.download_attempts, message);
        results.push({ sessionKey: s.session_key, error: message });
      }
    }
    return Response.json({ due: due.length, results, seconds: Math.round((Date.now() - started) / 1000) });
  } catch (e) {
    return errorJson(e);
  }
}

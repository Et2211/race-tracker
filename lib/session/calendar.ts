import "server-only";
import { openf1 } from "@/lib/openf1/client";
import type { Meeting, Session } from "@/lib/openf1/types";
import { supabase } from "@/lib/storage/supabase";
import { PICKER_SESSIONS } from "./catalog";

/**
 * The published session calendar in Supabase (`session_calendar`). A database job checks it every
 * 15 minutes and calls the app only when a session is final and not yet stored (`due_sessions()`).
 */

/** Copy a season's schedule from OpenF1 into the calendar: two OpenF1 requests per season. */
export async function refreshCalendar(year: number): Promise<number> {
  const [meetings, sessions] = await Promise.all([openf1<Meeting>("meetings", { year }), openf1<Session>("sessions", { year })]);
  const meetingFor = new Map(meetings.map((m) => [m.meeting_key, m]));
  const rows = sessions
    .filter((s) => PICKER_SESSIONS.includes(s.session_name) && !/testing/i.test(meetingFor.get(s.meeting_key)?.meeting_name ?? ""))
    .map((s) => ({
      session_key: s.session_key,
      year: s.year,
      meeting_key: s.meeting_key,
      meeting_name: meetingFor.get(s.meeting_key)?.meeting_name ?? s.circuit_short_name,
      circuit: s.circuit_short_name,
      session_name: s.session_name,
      date_start: s.date_start,
      date_end: s.date_end,
      is_cancelled: Boolean(s.is_cancelled || meetingFor.get(s.meeting_key)?.is_cancelled),
      updated_at: new Date().toISOString(),
    }));
  if (!rows.length) return 0;
  // Upsert only the schedule columns, so download attempts and errors are kept.
  const { error } = await supabase().from("session_calendar").upsert(rows, { onConflict: "session_key" });
  if (error) throw error;
  return rows.length;
}

export type DueSession = { session_key: number; meeting_name: string; session_name: string; download_attempts: number; date_end: string; year: number };

export async function dueSessions(): Promise<DueSession[]> {
  const { data, error } = await supabase().rpc("due_sessions");
  if (error) throw error;
  return data as DueSession[];
}

async function updateAttempt(sessionKey: number, fields: { download_attempts: number; last_error: string | null; last_attempt_at?: string }) {
  const { error } = await supabase()
    .from("session_calendar")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("session_key", sessionKey);
  if (error) throw error;
}

/**
 * Count an automatic download attempt before it starts, so a run cut off by the time limit still
 * counts towards the limit of 8 and waits its 30 minutes before the next.
 */
export function startAttempt(sessionKey: number, attempts: number) {
  return updateAttempt(sessionKey, { download_attempts: attempts + 1, last_attempt_at: new Date().toISOString(), last_error: "Started; did not report back (cut off by the time limit?)" });
}

/** The attempt's outcome: `error` null when the session is now fully stored (the attempt then does not count). */
export function finishAttempt(sessionKey: number, attemptsBefore: number, error: string | null) {
  return updateAttempt(sessionKey, { download_attempts: error ? attemptsBefore + 1 : attemptsBefore, last_error: error });
}

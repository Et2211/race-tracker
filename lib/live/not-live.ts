import { replayAfter } from "@/lib/session/catalog";

/** Relays start this long before a session (see live_session_now()). */
export const LIVE_OPENS_BEFORE_MS = 20 * 60_000;

/**
 * Why a session cannot be opened live, with the times a viewer needs: it has not started (live
 * timing opens 20 minutes before), or it has ended (with when its replay opens: see replayAfter).
 */
export type NotLive =
  | { code: "upcoming"; startsAt: number; opensAt: number }
  | { code: "ended"; endedAt: number; replayAt: number }
  | { code: "not-live" };

/** From the session's calendar entry (null: not in the calendar); `live_only` marks practice. */
export function notLiveReason(session: { date_start: string; date_end: string; live_only?: boolean } | null, now: number): NotLive {
  if (!session) return { code: "not-live" };
  const start = Date.parse(session.date_start);
  const end = Date.parse(session.date_end);
  if (now < start) return { code: "upcoming", startsAt: start, opensAt: start - LIVE_OPENS_BEFORE_MS };
  if (now > end) return { code: "ended", endedAt: end, replayAt: end + replayAfter(session.live_only === true) };
  return { code: "not-live" };
}

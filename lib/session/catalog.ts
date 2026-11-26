import type { Meeting, Session } from "@/lib/openf1/types";
/** The session picker's data: past race, sprint and qualifying sessions by season and meeting. */
export type CatalogSession = {
  sessionKey: number;
  name: string;
  type: string;
  dateStart: string;
  dateEnd: string;
  /** Ended long enough ago for OpenF1's data to be final. */
  available: boolean;
  /** Not started yet; listed from the published calendar. */
  upcoming: boolean;
  /** Already downloaded into the store, so it opens without contacting OpenF1. */
  downloaded: boolean;
  /** Practice: not stored for good; a replay is kept for a week after someone first opens it (practice-store.ts). */
  notStored?: boolean;
};
export type CatalogMeeting = {
  meetingKey: number;
  name: string;
  circuit: string;
  circuitKey: number;
  dateStart: string;
  dateEnd: string;
  /** Cancelled rounds stay on the calendar, marked, with no sessions to open. */
  cancelled: boolean;
  sessions: CatalogSession[];
};
export type Catalog = { year: number; meetings: CatalogMeeting[]; fetchedAt: string; source: "openf1" | "fixtures" };

export const FIRST_YEAR = 2023;
export const PICKER_SESSIONS = ["Sprint Qualifying", "Sprint", "Qualifying", "Race"];
/** Practice: on the calendar, followed live, and opened as a replay that is kept for a week, not for good (owner's decision). */
export const isPractice = (s: { session_type?: string; type?: string }) => (s.session_type ?? s.type) === "Practice";

/** OpenF1 keeps adding results and pit data for a few hours after a session ends. */
export const SETTLE_MS = 3 * 60 * 60_000;
/**
 * When a session's replay opens, after its end. Stored sessions wait until OpenF1 has settled, so
 * what is kept is complete. Practice opens when live coverage stops, 30 minutes after the end:
 * until it has settled each opening builds it afresh, and only then is it kept (for a week).
 */
export const replayAfter = (practice: boolean) => (practice ? 30 * 60_000 : SETTLE_MS);

/** A season's meetings and sessions as the picker and homepage list them (practice included, live only). */
export function buildCatalog(year: number, meetings: Meeting[], sessions: Session[], source: Catalog["source"]): Catalog {
  return {
    year,
    source,
    fetchedAt: new Date().toISOString(),
    meetings: meetings
      .filter((m) => !/testing/i.test(m.meeting_name))
      .map((m) => ({
        meetingKey: m.meeting_key,
        name: m.meeting_name,
        circuit: m.circuit_short_name,
        circuitKey: m.circuit_key,
        dateStart: m.date_start,
        dateEnd: m.date_end ?? m.date_start,
        cancelled: Boolean(m.is_cancelled),
        sessions: sessions
          .filter((s) => s.meeting_key === m.meeting_key && (PICKER_SESSIONS.includes(s.session_name) || isPractice(s)) && !s.is_cancelled && !m.is_cancelled)
          .sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start))
          .map((s) => ({ sessionKey: s.session_key, name: s.session_name, type: s.session_type, dateStart: s.date_start, dateEnd: s.date_end, available: false, upcoming: false, downloaded: false, ...(isPractice(s) ? { notStored: true } : {}) })),
      }))
      .filter((m) => m.sessions.length > 0 || m.cancelled)
      .sort((a, b) => a.dateStart.localeCompare(b.dateStart)),
  };
}

/** Marks each session upcoming, available (final, so downloadable) and downloaded, as of now. */
export function withStatus(catalog: Catalog, isDownloaded: (sessionKey: number) => boolean): Catalog {
  const now = Date.now();
  for (const m of catalog.meetings) {
    for (const s of m.sessions) {
      s.upcoming = Date.parse(s.dateStart) > now;
      s.available = Date.parse(s.dateEnd) + replayAfter(isPractice(s)) < now;
      s.downloaded = isDownloaded(s.sessionKey);
    }
  }
  return catalog;
}

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

/** OpenF1 keeps adding results and pit data for a few hours after a session ends. */
export const SETTLE_MS = 3 * 60 * 60_000;

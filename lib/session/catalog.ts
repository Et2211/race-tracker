/** The session picker's data: past race, sprint and qualifying sessions by season and meeting. */
export type CatalogSession = {
  sessionKey: number;
  name: string;
  type: string;
  dateStart: string;
  dateEnd: string;
  /** Ended long enough ago for OpenF1's data to be final. */
  available: boolean;
  /** Already downloaded into the store, so it opens without contacting OpenF1. */
  downloaded: boolean;
};
export type CatalogMeeting = { meetingKey: number; name: string; circuit: string; dateStart: string; sessions: CatalogSession[] };
export type Catalog = { year: number; meetings: CatalogMeeting[]; fetchedAt: string; source: "openf1" | "fixtures" };

export const FIRST_YEAR = 2023;
export const PICKER_SESSIONS = ["Sprint Qualifying", "Sprint", "Qualifying", "Race"];

import { describe, expect, it } from "vitest";
import type { HomeData } from "./data";
import { pickNext } from "./next";

const session = (sessionKey: number, start: string, end: string) => ({ sessionKey, name: "Race", type: "Race", dateStart: start, dateEnd: end, available: false, upcoming: true, downloaded: false });
const meetings = [
  { meetingKey: 1, sessions: [session(11, "2026-11-21T04:00:00Z", "2026-11-21T05:00:00Z"), session(12, "2026-11-22T04:00:00Z", "2026-11-22T06:00:00Z")] },
  { meetingKey: 2, sessions: [session(21, "2026-11-29T16:00:00Z", "2026-11-29T18:00:00Z")] },
] as unknown as HomeData["meetings"];
const at = (iso: string) => pickNext(meetings, Date.parse(iso))?.session.sessionKey ?? null;

describe("next session", () => {
  it("is the first one still to come", () => expect(at("2026-11-20T12:00:00Z")).toBe(11));
  it("stays on a session while it runs and for 30 minutes after, while it can be watched live", () => {
    expect(at("2026-11-21T04:30:00Z")).toBe(11);
    expect(at("2026-11-21T05:29:00Z")).toBe(11);
    expect(at("2026-11-21T05:31:00Z")).toBe(12);
  });
  it("moves to the next meeting, and is null once the season is over", () => {
    expect(at("2026-11-23T00:00:00Z")).toBe(21);
    expect(at("2026-12-01T00:00:00Z")).toBeNull();
  });
});

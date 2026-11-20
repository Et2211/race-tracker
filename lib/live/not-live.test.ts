import { describe, expect, it } from "vitest";
import { notLiveReason } from "./not-live";

const s = { date_start: "2026-11-21T04:00:00Z", date_end: "2026-11-21T05:00:00Z" };
const at = (iso: string) => Date.parse(iso);

describe("notLiveReason", () => {
  it("before the start: when live timing opens (20 minutes before)", () => {
    expect(notLiveReason(s, at("2026-11-20T12:00:00Z"))).toEqual({ code: "upcoming", startsAt: at("2026-11-21T04:00:00Z"), opensAt: at("2026-11-21T03:40:00Z") });
  });
  it("after the end: when the replay is ready (three hours after)", () => {
    expect(notLiveReason(s, at("2026-11-21T05:10:00Z"))).toEqual({ code: "ended", endedAt: at("2026-11-21T05:00:00Z"), replayAt: at("2026-11-21T08:00:00Z") });
  });
  it("practice (never stored): its replay opens when live coverage stops, 30 minutes after the end", () => {
    expect(notLiveReason({ ...s, live_only: true }, at("2026-11-21T05:10:00Z"))).toMatchObject({ code: "ended", replayAt: at("2026-11-21T05:30:00Z") });
  });
  it("during it, or not in the calendar: no reason to give", () => {
    expect(notLiveReason(s, at("2026-11-21T04:30:00Z"))).toEqual({ code: "not-live" });
    expect(notLiveReason(null, at("2026-11-21T04:30:00Z"))).toEqual({ code: "not-live" });
  });
});

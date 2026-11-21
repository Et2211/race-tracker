import { describe, expect, it } from "vitest";
import type { Lap, RaceControl } from "@/lib/openf1/types";
import { fixture } from "@/test/fixtures";
import { practiceClock, qualifyingClock, quietStretches } from "./session-clock";

// São Paulo 2026: Q1 red-flagged after 2:23 and restarted; Q2 red-flagged at 14:17 and never resumed.
const rc = fixture<RaceControl[]>("2026-sao-paulo-qualifying", "race_control");
const laps = fixture<Lap[]>("2026-sao-paulo-qualifying", "laps");
const at = (hms: string) => Date.parse(`2026-11-07T${hms}Z`);
/** The clock as shown: to the second. */
const clock = (hms: string) => {
  const c = qualifyingClock(rc, at(hms), false, 2026);
  if ("remainingMs" in c) return { ...c, remainingMs: Math.round(c.remainingMs / 1000) * 1000 };
  if ("startsAt" in c && c.startsAt !== null) return { ...c, startsAt: Math.round(c.startsAt / 1000) * 1000 };
  return c;
};

describe("qualifying clock", () => {
  it("counts down while a phase runs and stops under a red flag", () => {
    expect(clock("17:59:00")).toMatchObject({ state: "before", phase: 1 });
    expect(clock("18:01:00")).toEqual({ state: "running", phase: 1, remainingMs: 17 * 60_000 });
    expect(clock("18:30:00")).toEqual({ state: "stopped", phase: 1, remainingMs: (18 * 60 - 143) * 1000 });
    expect(clock("19:30:00")).toEqual({ state: "running", phase: 1, remainingMs: (18 * 60 - 143 - 240) * 1000 });
  });

  it("shows the break and when the next phase starts", () => {
    expect(clock("19:47:00")).toEqual({ state: "break", finished: 1, next: 2, startsAt: at("19:49:00") });
  });

  it("keeps the time left when a phase is stopped and never resumed", () => {
    // Q2 is 15 minutes; it ran 14:17 before the red flag.
    expect(clock("20:04:00")).toEqual({ state: "stopped", phase: 2, remainingMs: 42_000 }); // 14:17.8 run, so 0:42 left
    expect(clock("20:07:00")).toMatchObject({ state: "break", finished: 2, next: 3 });
  });

  it("is over after Q3", () => {
    expect(clock("20:13:59")).toMatchObject({ state: "break", next: 3 });
    expect(clock("20:20:00")).toEqual({ state: "running", phase: 3, remainingMs: 7 * 60_000 });
    expect(clock("20:40:00")).toEqual({ state: "over" });
  });
});

describe("quiet stretches", () => {
  it("cover the Q1 red flag and the breaks between phases, and nothing while cars run", () => {
    const quiet = quietStretches(rc, laps);
    const inQuiet = (hms: string) => quiet.some(([a, b]) => at(hms) >= a && at(hms) < b);
    expect(inQuiet("18:30:00")).toBe(true); // Q1 red flag
    expect(inQuiet("19:47:00")).toBe(true); // break before Q2
    expect(inQuiet("20:10:00")).toBe(true); // break before Q3
    expect(inQuiet("18:01:00")).toBe(false);
    expect(inQuiet("19:30:00")).toBe(false);
    expect(inQuiet("20:20:00")).toBe(false);
    // Stops before the restart, so the restart itself is shown.
    expect(inQuiet("19:25:50")).toBe(false);
  });
});

// Race-control rows copied from real 2026 practice sessions (only the ones the clock reads).
const row = (date: string, message: string, flag: string | null = null): RaceControl => ({
  date, message, flag, category: flag ? "Flag" : "Other", scope: null, sector: null, driver_number: null, lap_number: null, qualifying_phase: null,
});
const red = (date: string) => [row(date, "SESSION ABORTED"), row(date, "RED FLAG", "RED")];
const finished = (date: string) => [row(date, "CHEQUERED FLAG", "CHEQUERED"), row(date, "SESSION FINISHED")];
const seconds = (c: ReturnType<typeof practiceClock>) => (c && "remainingMs" in c ? { ...c, remainingMs: Math.round(c.remainingMs / 1000) } : c);

describe("practice clock", () => {
  // Montréal FP1: three red flags, extended by 4 and then a further 15 minutes; finished at 17:49.
  const montreal = { date_start: "2026-05-22T16:30:00+00:00", date_end: "2026-05-22T17:30:00+00:00", gmt_offset: "-04:00:00" };
  const montrealRc = [
    row("2026-05-22T16:30:00Z", "SESSION STARTED"),
    ...red("2026-05-22T16:41:14Z"),
    row("2026-05-22T16:46:00Z", "SESSION STARTED"),
    row("2026-05-22T16:47:01Z", "FREE PRACTICE 1 WILL BE EXTENDED BY 4 MINUTES"),
    ...red("2026-05-22T16:57:30Z"),
    row("2026-05-22T17:12:01Z", "FREE PRACTICE 1 WILL BE EXTENDED BY A FURTHER 15 MINUTES"),
    row("2026-05-22T17:13:00Z", "SESSION STARTED"),
    ...red("2026-05-22T17:43:20Z"),
    row("2026-05-22T17:48:00Z", "SESSION STARTED"),
    ...finished("2026-05-22T17:49:00Z"),
  ];
  const mtl = (hms: string) => seconds(practiceClock(montreal, montrealRc, Date.parse(`2026-05-22T${hms}Z`)));

  it("keeps running under a red flag, unlike qualifying", () => {
    expect(mtl("16:29:00")).toEqual({ state: "before", startsAt: Date.parse("2026-05-22T16:30:00Z") });
    expect(mtl("16:40:00")).toEqual({ state: "running", remainingMs: 50 * 60 });
    expect(mtl("16:44:00")).toEqual({ state: "red", remainingMs: 46 * 60 });
  });

  it("adds extensions once race control announces them", () => {
    expect(mtl("16:47:00")).toEqual({ state: "running", remainingMs: 43 * 60 }); // not yet announced
    expect(mtl("16:48:00")).toEqual({ state: "running", remainingMs: 46 * 60 }); // +4
    expect(mtl("17:20:00")).toEqual({ state: "running", remainingMs: 29 * 60 }); // +4 +15: ends 17:49
    expect(mtl("17:48:30")).toEqual({ state: "running", remainingMs: 30 });
    expect(mtl("17:49:01")).toEqual({ state: "over" });
  });

  it("runs the full length from a start moved to a new local time", () => {
    // Melbourne FP3: planned 12:30 local (UTC+11), moved to 12:50, so it ran to 13:50.
    const melbourne = { date_start: "2026-03-07T01:30:00+00:00", date_end: "2026-03-07T02:30:00+00:00", gmt_offset: "11:00:00" };
    const rc = [
      row("2026-03-07T01:46:58Z", "SESSION WILL START AT 12:50"),
      row("2026-03-07T01:50:00Z", "SESSION STARTED"),
      ...finished("2026-03-07T02:50:00Z"),
    ];
    const at = (hms: string) => seconds(practiceClock(melbourne, rc, Date.parse(`2026-03-07T${hms}Z`)));
    expect(at("01:45:00")).toEqual({ state: "before", startsAt: Date.parse("2026-03-07T01:50:00Z") });
    expect(at("02:40:00")).toEqual({ state: "running", remainingMs: 10 * 60 });
  });

  it("ends when a red flag runs out the clock with no chequered flag", () => {
    // Spielberg FP1: red-flagged at 12:28:44 and never restarted before the 12:30 end.
    const spielberg = { date_start: "2026-06-26T11:30:00+00:00", date_end: "2026-06-26T12:30:00+00:00", gmt_offset: "02:00:00" };
    const rc = [row("2026-06-26T11:30:00Z", "SESSION STARTED"), ...red("2026-06-26T12:28:44Z")];
    expect(seconds(practiceClock(spielberg, rc, Date.parse("2026-06-26T12:29:00Z")))).toEqual({ state: "red", remainingMs: 60 });
    expect(practiceClock(spielberg, rc, Date.parse("2026-06-26T12:31:00Z"))).toEqual({ state: "over" });
  });

  it("says so rather than inventing a time when cars run well past the end", () => {
    const s = { date_start: "2026-09-12T10:30:00+00:00", date_end: "2026-09-12T11:30:00+00:00", gmt_offset: "02:00:00" };
    const rc = [row("2026-09-12T10:30:00Z", "SESSION STARTED")];
    expect(seconds(practiceClock(s, rc, Date.parse("2026-09-12T11:30:10Z")))).toEqual({ state: "running", remainingMs: 0 });
    expect(practiceClock(s, rc, Date.parse("2026-09-12T11:35:00Z"))).toEqual({ state: "overrun" });
  });

  it("leaves pre-season testing days alone", () => {
    const testing = { date_start: "2026-02-11T07:00:00+00:00", date_end: "2026-02-11T16:00:00+00:00", gmt_offset: "03:00:00" };
    expect(practiceClock(testing, [], Date.parse("2026-02-11T08:00:00Z"))).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { Lap, LocationRow, RaceControl, Session } from "@/lib/openf1/types";
import { outlineFrom, runningSpan } from "@/lib/session/assemble";
import { fixture } from "@/test/fixtures";
import { pointAt } from "./geometry";
import { placeMarshalSector, sectorsFromMultiViewer } from "./markers";

const lap = fixture<Lap[]>("2026-madrid-race", "laps").find((l) => l.driver_number === 63 && l.lap_number === 49)!;
const outline = outlineFrom(lap, fixture<LocationRow[]>("2026-madrid-race", "location.outline-lap-63-49"))!;

/** Markers placed on the outline at the given distances (metres), as a MultiViewer file would. */
const markersAt = (metres: number[]) => ({
  year: 2026,
  marshalSectors: metres.map((m, i) => {
    const p = pointAt(outline, m * 10);
    return { number: i + 1, trackPosition: { x: p.x, y: p.y } };
  }),
});

describe("marshal-sector placement", () => {
  it("runs a sector from its marker to the next, wrapping past the line", () => {
    const sectors = sectorsFromMultiViewer(outline, markersAt([5300, 400, 1500, 3000, 4500]))!;
    expect(sectors.source).toBe("multiviewer");
    const s3 = placeMarshalSector(sectors, outline, 3);
    expect(s3.kind).toBe("stretch");
    if (s3.kind === "stretch") {
      expect(s3.from / 10).toBeCloseTo(1500, -1);
      expect(s3.to / 10).toBeCloseTo(3000, -1);
    }
    // The last sector ends at marker 1.
    const s5 = placeMarshalSector(sectors, outline, 5);
    if (s5.kind === "stretch") expect(s5.to / 10).toBeCloseTo(5300, -1);
  });

  it("rejects markers that are not in lap order", () => {
    expect(sectorsFromMultiViewer(outline, markersAt([400, 3000, 1500, 4500]))).toBeNull();
  });

  it("rejects markers off the outline (a different layout)", () => {
    const file = markersAt([400, 1500, 3000]);
    file.marshalSectors[1].trackPosition.x += 2000; // 200 m away
    expect(sectorsFromMultiViewer(outline, file)).toBeNull();
  });

  it("draws learned positions only when two observations agree", () => {
    const one = placeMarshalSector({ source: "learned", count: 26, observations: { 23: [47300] } }, outline, 23);
    expect(one.kind).toBe("unknown");
    const two = placeMarshalSector({ source: "learned", count: 26, observations: { 23: [47300, 47500] } }, outline, 23);
    expect(two.kind).toBe("stretch");
    const apart = placeMarshalSector({ source: "learned", count: 26, observations: { 23: [47300, 30000] } }, outline, 23);
    expect(apart.kind).toBe("unknown");
  });
});

describe("replay span", () => {
  it("covers a session that overran its scheduled end", () => {
    const session = fixture<Session>("2026-sao-paulo-qualifying", "session");
    const rc = fixture<RaceControl[]>("2026-sao-paulo-qualifying", "race_control");
    const laps = fixture<Lap[]>("2026-sao-paulo-qualifying", "laps");
    const span = runningSpan("qualifying", laps, rc, session);
    const lastFinish = Math.max(...rc.filter((r) => r.message === "SESSION FINISHED").map((r) => Date.parse(r.date)));
    expect(span.end).toBeGreaterThan(lastFinish);
    expect(span.end).toBeGreaterThan(Date.parse(session.date_end));
    expect(span.start).toBeLessThanOrEqual(Date.parse("2026-11-07T18:00:00.145Z"));
  });
});

describe("race-control rows from another day", () => {
  it("are dropped so the replay span stays on the session", async () => {
    const { ownRaceControl } = await import("@/lib/session/assemble");
    const session = fixture<Session>("2026-madrid-race", "session");
    const rc = fixture<RaceControl[]>("2026-madrid-race", "race_control");
    const stray: RaceControl = { ...rc[0], date: "2026-09-12T15:32:52+00:00", message: "SESSION STARTED" };
    const kept = ownRaceControl([stray, ...rc], session);
    expect(kept).toHaveLength(rc.length);
    const laps = fixture<Lap[]>("2026-madrid-race", "laps");
    const span = runningSpan("race", laps, kept, session);
    expect((span.end - span.start) / 3_600_000).toBeLessThan(3);
  });
});

describe("learned positions from the session being shown", () => {
  it("are left out", async () => {
    const { marshalSectors } = await import("@/lib/session/assemble");
    const learned = { count: 26, observations: { "23": [{ arc: 47300, session_key: 11369 }, { arc: 47350, session_key: 11369 }] } };
    expect(placeMarshalSector(marshalSectors(outline, null, learned, 11369), outline, 23).kind).toBe("unknown");
    expect(placeMarshalSector(marshalSectors(outline, null, learned, 99999), outline, 23).kind).toBe("stretch");
  });
});

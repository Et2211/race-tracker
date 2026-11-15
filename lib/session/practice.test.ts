import { describe, expect, it } from "vitest";
import type { Lap, Meeting, RaceControl, Session } from "@/lib/openf1/types";
import { jumpTargets } from "@/lib/replay/timeline";
import { syncPoints } from "@/lib/replay/sync";
import { buildQualifying } from "@/lib/timing/qualifying";
import { fixture } from "@/test/fixtures";
import { buildCatalog, withStatus } from "./catalog";
import { sessionKind } from "./types";

describe("practice sessions", () => {
  it("are their own kind", () => {
    expect(sessionKind({ session_type: "Practice", session_name: "Practice 1" })).toBe("practice");
    expect(sessionKind({ session_type: "Qualifying", session_name: "Sprint Qualifying" })).toBe("qualifying");
  });

  it("list the season's best laps as one table, with nobody eliminated", () => {
    // Qualifying laps stand in for a practice session's: one phase from the first green light.
    const laps = fixture<Lap[]>("2026-sao-paulo-qualifying", "laps");
    const rc = fixture<RaceControl[]>("2026-sao-paulo-qualifying", "race_control");
    const start = Math.min(...laps.filter((l) => l.date_start).map((l) => Date.parse(l.date_start!)));
    const { phases } = buildQualifying(laps, rc, { singlePhaseFrom: start });
    expect(phases).toHaveLength(1);
    expect(phases[0].cutAfter).toBeNull();
    const byPhase = buildQualifying(laps, rc).phases;
    // The fastest lap of the whole session tops the single table.
    const fastest = Math.min(...byPhase.flatMap((p) => p.rows.map((r) => r.lap)));
    expect(phases[0].rows[0].lap).toBe(fastest);
    expect(new Set(phases[0].rows.map((r) => r.driver)).size).toBe(phases[0].rows.length);
  });

  it("can be synced to the pit exit opening, and has no lap jumps", () => {
    const rc = [{ date: "2026-11-20T00:30:00Z", message: "SESSION STARTED", category: "Other", flag: null, scope: null, sector: null, driver_number: null, lap_number: null, qualifying_phase: null }] as RaceControl[];
    expect(syncPoints("practice", [], rc, "Practice 1").map((p) => p.id)).toEqual(["start"]);
    expect(jumpTargets("practice", fixture<Lap[]>("2026-madrid-race", "laps"), rc, "Practice 1")).toEqual([]);
  });

  it("are on the calendar, selectable once final, and marked as never stored", () => {
    const meeting = { meeting_key: 1, meeting_name: "Las Vegas Grand Prix", circuit_short_name: "Las Vegas", circuit_key: 1, date_start: "2026-11-20T00:00:00Z", date_end: "2026-11-22T06:00:00Z", year: 2026, is_cancelled: false } as unknown as Meeting;
    const s = (key: number, name: string, type: string, start: string, end: string) => ({ session_key: key, meeting_key: 1, session_name: name, session_type: type, date_start: start, date_end: end, is_cancelled: false }) as unknown as Session;
    const catalog = buildCatalog(2026, [meeting], [s(1, "Practice 1", "Practice", "2026-11-06T14:30:00Z", "2026-11-06T15:30:00Z"), s(2, "Race", "Race", "2026-11-08T17:00:00Z", "2026-11-08T19:00:00Z")], "openf1");
    const [fp1, race] = withStatus(catalog, () => false).meetings[0].sessions;
    expect(fp1).toMatchObject({ name: "Practice 1", notStored: true, available: true, downloaded: false });
    expect(race.notStored).toBeUndefined();
    expect(race.available).toBe(true);
  });
});

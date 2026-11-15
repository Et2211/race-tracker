import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Lap, RaceControl, SessionResult } from "@/lib/openf1/types";
import { buildQualifying, deletedLaps } from "@/lib/timing/qualifying";

const read = <T,>(p: string) => JSON.parse(readFileSync(path.join(process.cwd(), "fixtures/openf1", p), "utf8")) as T;

describe.each(["2026-madrid-qualifying", "2026-sao-paulo-qualifying"])("qualifying from %s", (slug) => {
  const laps = read<Lap[]>(`${slug}/laps.json`);
  const rc = read<RaceControl[]>(`${slug}/race_control.json`).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const result = read<SessionResult[]>(`${slug}/session_result.json`);
  const { phases } = buildQualifying(laps, rc);

  it("matches the official best time of every driver in every phase", () => {
    const mismatches: string[] = [];
    for (const r of result) {
      const official = r.duration as (number | null)[];
      official.forEach((time, i) => {
        const row = phases.find((p) => p.phase === i + 1)?.rows.find((x) => x.driver === r.driver_number);
        const mine = row?.lap ?? null;
        if ((time ?? null) !== mine && !(time !== null && mine !== null && Math.abs(time - mine) < 0.0005)) {
          mismatches.push(`#${r.driver_number} Q${i + 1}: official ${time} computed ${mine}`);
        }
      });
    }
    expect(mismatches).toEqual([]);
  });

  it("parses every deleted-lap message", () => {
    const messages = rc.filter((r) => /DELETED/.test(r.message) && !/REINSTATED/.test(r.message)).length;
    const reinstated = rc.filter((r) => /REINSTATED/.test(r.message)).length;
    expect(deletedLaps(rc).length).toBe(messages - reinstated);
  });

  it("draws the elimination line where the next phase's field ends", () => {
    const q2 = phases.find((p) => p.phase === 2)!;
    const q3 = phases.find((p) => p.phase === 3)!;
    const q2Field = new Set([...q2.rows.map((r) => r.driver), ...q2.noTime]);
    const q3Field = new Set([...q3.rows.map((r) => r.driver), ...q3.noTime]);
    expect(phases.find((p) => p.phase === 1)!.cutAfter).toBe(q2Field.size);
    expect(q2.cutAfter).toBe(q3Field.size);
    expect(q3.cutAfter).toBeNull();
  });
});

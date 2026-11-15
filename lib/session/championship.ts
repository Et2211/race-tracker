import "server-only";
import { openf1 } from "@/lib/openf1/client";
import type { Driver } from "@/lib/openf1/types";
import { readJson, writeJson } from "@/lib/storage/store";
import { SETTLE_MS } from "./catalog";

/**
 * Championship standings after a race-type session (race or sprint), from OpenF1's
 * championship endpoints (marked beta by OpenF1). Kept permanently once the session is final.
 */
export type Standings = {
  sessionKey: number;
  drivers: { driver: number; position: number; points: number }[];
  teams: { team: string; position: number; points: number }[];
  /** Who the numbers belong to in that session, so the standings never depend on a stored session. */
  people?: Person[];
};

export type Person = { number: number; code: string; fullName: string; lastName: string; team: string; colour: string };

const person = (d: Driver): Person => ({
  number: d.driver_number,
  code: d.name_acronym,
  fullName: d.full_name,
  lastName: d.last_name ?? d.full_name,
  team: d.team_name ?? "",
  colour: d.team_colour ? `#${d.team_colour}` : "#9AA3B2",
});

type DriverRow = { driver_number: number; position_current: number | null; points_current: number | null };
type TeamRow = { team_name: string; position_current: number | null; points_current: number | null };

const key = (sessionKey: number) => `championship/${sessionKey}.json`;

export const cachedStandings = (sessionKey: number) => readJson<Standings>(key(sessionKey));

/** Sessions OpenF1 had no table for, remembered for an hour per server instance so a homepage miss doesn't ask again. */
const noTable = new Map<number, number>();

/** Standings after a session: cached, or fetched from OpenF1 (3 requests) and cached once final. */
export async function standingsAfter(sessionKey: number, dateEnd: string): Promise<Standings | null> {
  const asked = noTable.get(sessionKey);
  if (asked && Date.now() - asked < 60 * 60_000) return null;
  const cached = await cachedStandings(sessionKey);
  if (cached?.people) return cached;
  if (cached) {
    // Cached before names were kept: add them once.
    const withPeople = { ...cached, people: (await openf1<Driver>("drivers", { session_key: sessionKey })).map(person) };
    await writeJson(key(sessionKey), withPeople);
    return withPeople;
  }
  const [drivers, teams, people] = await Promise.all([
    openf1<DriverRow>("championship_drivers", { session_key: sessionKey }),
    openf1<TeamRow>("championship_teams", { session_key: sessionKey }),
    openf1<Driver>("drivers", { session_key: sessionKey }),
  ]);
  if (!drivers.length) {
    noTable.set(sessionKey, Date.now());
    return null;
  }
  const standings: Standings = {
    sessionKey,
    drivers: drivers
      .filter((d) => d.position_current !== null)
      .map((d) => ({ driver: d.driver_number, position: d.position_current!, points: d.points_current ?? 0 }))
      .sort((a, b) => a.position - b.position),
    teams: teams
      .filter((t) => t.position_current !== null)
      .map((t) => ({ team: t.team_name, position: t.position_current!, points: t.points_current ?? 0 }))
      .sort((a, b) => a.position - b.position),
    people: people.map(person),
  };
  // Points can still change for a few hours (penalties, results being finalised).
  if (Date.parse(dateEnd) + SETTLE_MS < Date.now()) await writeJson(key(sessionKey), standings);
  return standings;
}

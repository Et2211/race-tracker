import "server-only";
import { cacheLife } from "next/cache";
import { cachedStandings, standingsAfter } from "@/lib/session/championship";
import type { CatalogMeeting, CatalogSession } from "@/lib/session/catalog";
import { fixtureMeta, fixtureSessions } from "@/lib/session/fixtures";
import { circuitKeyPath, summaryKey } from "@/lib/session/ingest";
import { dataMode, getCatalog } from "@/lib/session/source";
import { circuitShape, summarize, type CircuitShape, type SessionSummary } from "@/lib/session/summary";
import { sessionIndex, type StorageUsage } from "@/lib/storage/session-index";
import { readJson } from "@/lib/storage/store";

export type HomeMeeting = CatalogMeeting & {
  /** Round number among the rounds that were not cancelled. */
  round: number | null;
  shape: CircuitShape | null;
  winner: { code: string; name: string; number: number; colour: string } | null;
};

export type StandingDriver = { position: number; driver: number; code: string; name: string; fullName: string; team: string; colour: string; points: number };
export type StandingTeam = { position: number; team: string; colour: string; points: number };

export type Progression = {
  /** One column per round with a race result. */
  rounds: { round: number; label: string }[];
  series: { driver: number; code: string; name: string; colour: string; dashed: boolean; points: (number | null)[] }[];
  /** Rounds whose standings are not cached yet. */
  missing: number;
};

export type HomeData = {
  year: number;
  /** When this was worked out (cached for a few minutes), for "live now" marks. */
  now: number;
  source: "openf1" | "fixtures";
  meetings: HomeMeeting[];
  next: { meeting: HomeMeeting; session: CatalogSession } | null;
  latest: { meeting: HomeMeeting; summary: SessionSummary } | null;
  standings: { after: string; drivers: StandingDriver[]; teams: StandingTeam[] } | null;
  progression: Progression | null;
  storage: StorageUsage | null;
};

async function summaryFor(sessionKey: number): Promise<SessionSummary | null> {
  if (dataMode() === "fixtures") {
    const meta = await fixtureMeta(sessionKey, { multiviewer: null, learned: null });
    return meta ? summarize(meta) : null;
  }
  return readJson<SessionSummary>(summaryKey(sessionKey));
}

async function shapeFor(circuitKey: number): Promise<CircuitShape | null> {
  if (dataMode() === "fixtures") {
    for (const s of await fixtureSessions()) {
      if (s.circuit_key !== circuitKey) continue;
      const meta = await fixtureMeta(s.session_key, { multiviewer: null, learned: null });
      const shape = meta ? circuitShape(meta) : null;
      if (shape) return shape;
    }
    return null;
  }
  return readJson<CircuitShape>(circuitKeyPath(circuitKey));
}

const isRaceType = (s: CatalogSession) => s.type === "Race"; // races and sprints score points

export async function getHomeData(year: number): Promise<HomeData> {
  "use cache";
  cacheLife("minutes");

  const catalog = await getCatalog(year);
  let round = 0;
  const shapes = new Map<number, Promise<CircuitShape | null>>();
  const meetings: HomeMeeting[] = await Promise.all(
    catalog.meetings.map(async (m) => {
      if (!shapes.has(m.circuitKey)) shapes.set(m.circuitKey, shapeFor(m.circuitKey));
      const race = m.sessions.find((s) => s.name === "Race" && s.downloaded);
      const summary = race ? await summaryFor(race.sessionKey) : null;
      const winnerNo = summary?.classification[0]?.driver;
      const winner = summary?.drivers.find((d) => d.number === winnerNo);
      return { ...m, round: null, shape: await shapes.get(m.circuitKey)!, winner: winner ? { code: winner.code, name: winner.name, number: winner.number, colour: winner.colour } : null };
    }),
  );
  for (const m of meetings) if (!m.cancelled) m.round = ++round;

  const now = Date.now();
  let next: HomeData["next"] = null;
  for (const m of meetings) {
    const s = m.sessions.find((x) => Date.parse(x.dateEnd) > now);
    if (s) {
      next = { meeting: m, session: s };
      break;
    }
  }

  // The latest race (not sprint) that is downloaded, for the recap.
  let latest: HomeData["latest"] = null;
  for (const m of [...meetings].reverse()) {
    const race = m.sessions.find((s) => s.name === "Race" && s.downloaded);
    const summary = race ? await summaryFor(race.sessionKey) : null;
    if (summary) {
      latest = { meeting: m, summary };
      break;
    }
  }

  let standings: HomeData["standings"] = null;
  let progression: Progression | null = null;
  if (catalog.source === "openf1") {
    // Standings after each round's last points-scoring session (the race, or a sprint before it).
    const scored = meetings
      .filter((m) => !m.cancelled)
      .map((m) => ({ meeting: m, session: [...m.sessions].reverse().find((s) => isRaceType(s) && s.available) }))
      .filter((x): x is { meeting: HomeMeeting; session: CatalogSession } => Boolean(x.session));
    const last = scored.at(-1);
    const current = last ? await standingsAfter(last.session.sessionKey, last.session.dateEnd).catch(() => null) : null;
    if (last && current) {
      // Names and colours as OpenF1 lists them for that session; a stored summary fills any gap.
      const people = new Map<number, { code: string; name: string; fullName: string; team: string; colour: string }>();
      for (const p of current.people ?? []) people.set(p.number, { code: p.code, name: p.lastName, fullName: p.fullName, team: p.team, colour: p.colour });
      for (const x of [...scored].reverse()) {
        if (current.drivers.every((d) => people.has(d.driver))) break;
        const s = await summaryFor(x.session.sessionKey);
        for (const d of s?.drivers ?? []) if (!people.has(d.number)) people.set(d.number, { code: d.code, name: d.name, fullName: d.name, team: d.team, colour: d.colour });
      }
      const teamColour = new Map<string, string>();
      for (const d of people.values()) if (!teamColour.has(d.team)) teamColour.set(d.team, d.colour);
      standings = {
        after: `${last.meeting.name} ${last.session.name}`,
        drivers: current.drivers.map((d) => {
          const p = people.get(d.driver);
          return { position: d.position, driver: d.driver, code: p?.code ?? `#${d.driver}`, name: p?.name ?? "", fullName: p?.fullName ?? "", team: p?.team ?? "", colour: p?.colour ?? "#9AA3B2", points: d.points };
        }),
        teams: current.teams.map((t) => ({ position: t.position, team: t.team, colour: teamColour.get(t.team) ?? "#9AA3B2", points: t.points })),
      };
      // Progression of the current top five, from cached standings only (no OpenF1 calls here).
      const perRound = await Promise.all(scored.map((x) => (x.session.sessionKey === current.sessionKey ? current : cachedStandings(x.session.sessionKey))));
      const top = standings.drivers.slice(0, 5);
      const seenTeams = new Set<string>();
      progression = {
        rounds: scored.map((x) => ({ round: x.meeting.round ?? 0, label: x.meeting.circuit })),
        series: top.map((d) => {
          const dashed = seenTeams.has(d.team); // a second driver of the same team is drawn dashed
          seenTeams.add(d.team);
          return { driver: d.driver, code: d.code, name: d.name, colour: d.colour, dashed, points: perRound.map((s) => s?.drivers.find((x) => x.driver === d.driver)?.points ?? null) };
        }),
        missing: perRound.filter((s) => !s).length,
      };
    }
  }

  const storage = catalog.source === "openf1" ? await sessionIndex().usage().catch(() => null) : null;
  return { year, now, source: catalog.source, meetings, next, latest, standings, progression, storage };
}

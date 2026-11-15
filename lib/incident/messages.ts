import type { RaceControl } from "@/lib/openf1/types";

/** A race-control message that names cars in an incident, e.g. "TURN 5 INCIDENT INVOLVING CARS 55 (SAI) AND 14 (ALO) NOTED (15:23:42)". */
export type NamedIncident = {
  /** When the message was posted (UTC). */
  postedAt: number;
  /** When the incident happened, from the local time in brackets; null if the message has none. */
  happenedAt: number | null;
  turn: number | null;
  drivers: number[];
  message: string;
};

const CARS = /CARS? ((?:\d+ \([A-Z]{3}\)(?:, | AND )?)+)/;
const LOCAL_TIME = /\((\d{1,2}):(\d{2}):{1,2}(\d{2})\)\s*$/; // the feed sometimes has "15:12::25"
const TURN = /\bTURN (\d+)\b/;
/** Incidents that are not about a car stopping or colliding on track. */
const NOT_ON_TRACK = /PIT LANE|PIT EXIT|PIT ENTRY|FALSE START|START(ING)? PROCEDURE|FORMATION|SPEEDING|UNSAFE RELEASE|TECHNICAL|POWER UNIT|TYRE|ENGINE|PARC FERME|WEIGHT|REFUELLING|PRACTICE START|DRS|OVERTAKE MODE|BLUE FLAG/;
/** Driving offences that do not involve a stop. */
const NOT_A_STOP = /TRACK LIMITS|LEAVING THE TRACK AND GAINING|MOVING UNDER BRAKING|IMPEDING|DRIVING UNNECESSARILY SLOWLY|MAXIMUM DELTA|YELLOW FLAG INFRINGEMENT|SAFETY CAR INFRINGEMENT|RED FLAG INFRINGEMENT|CROSSING THE LINE|FAILING TO FOLLOW|ERRATICALLY/;

/**
 * Parse incident messages that name cars. `gmtOffset` is the meeting's "HH:MM:SS" offset, used to
 * turn the local time in brackets into UTC. Only messages about on-track incidents are returned;
 * pit-lane, start and paperwork offences are left out. Updates repeat the same incident and are kept.
 */
export function namedIncidents(raceControl: RaceControl[], gmtOffset: string): NamedIncident[] {
  const [oh, om] = gmtOffset.replace(/^-/, "").split(":").map(Number);
  const offsetMs = (gmtOffset.startsWith("-") ? -1 : 1) * (oh * 60 + om) * 60_000;
  const out: NamedIncident[] = [];
  for (const row of raceControl) {
    const m = row.message;
    if (!/INCIDENT INVOLVING/.test(m) || NOT_ON_TRACK.test(m) || NOT_A_STOP.test(m)) continue;
    const cars = CARS.exec(m);
    if (!cars) continue;
    const drivers = [...cars[1].matchAll(/(\d+) \(/g)].map((x) => Number(x[1]));
    const postedAt = Date.parse(row.date);
    let happenedAt: number | null = null;
    const local = LOCAL_TIME.exec(m);
    if (local) {
      // The local clock time on the day of posting, converted to UTC; pick the instance nearest before posting.
      const day = new Date(postedAt + offsetMs);
      const guess = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), Number(local[1]), Number(local[2]), Number(local[3])) - offsetMs;
      happenedAt = guess > postedAt + 60_000 ? guess - 86_400_000 : guess;
    }
    const turn = TURN.exec(m);
    out.push({ postedAt, happenedAt, turn: turn ? Number(turn[1]) : null, drivers, message: m });
  }
  return out;
}

/** Incidents that happened (or, without a time, were posted) close to a flag. */
export function incidentsNear(incidents: NamedIncident[], flagAt: number, before = 90_000, after = 30_000): NamedIncident[] {
  return incidents.filter((i) => i.happenedAt !== null && i.happenedAt >= flagAt - before && i.happenedAt <= flagAt + after);
}

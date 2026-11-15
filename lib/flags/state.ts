import type { RaceControl } from "@/lib/openf1/types";

export type SectorFlag = { sector: number; flag: "YELLOW" | "DOUBLE YELLOW"; since: number };

/** Sector flags raised together for one incident: the incident sector and the warning sector before it. */
export type FlagGroup = {
  flag: "YELLOW" | "DOUBLE YELLOW";
  /** The sector of the incident: the double-yellow one, else the highest-numbered. */
  sector: number;
  sectors: number[];
  since: number;
  lap: number | null;
};

export type SafetyCarState = { kind: "SC" | "VSC"; since: number; ending: boolean } | null;

export type FlagState = {
  sectorFlags: SectorFlag[];
  groups: FlagGroup[];
  safetyCar: SafetyCarState;
  /** Session suspended: from a red flag until the next "SESSION STARTED". */
  red: boolean;
};

/**
 * Measured over the 52 completed 2026 race and qualifying sessions: 939 sector-flag episodes,
 * 827 ended by a sector CLEAR, 39 by a chequered flag, session end or abort, 72 never ended
 * in the feed. Flags are never expired on a timer; the UI states how long a flag has gone
 * without a clear message instead (see STALE_AFTER_MS).
 */
export const STALE_AFTER_MS = 10 * 60_000;

/** Sector flags raised within this window of each other on neighbouring sectors belong to one incident. */
const GROUP_WINDOW_MS = 5000;

/** Fold race-control messages up to time `t` into the flags in force at `t`. Rows must be sorted by date. */
export function flagStateAt(raceControl: RaceControl[], t: number): FlagState {
  const sectors = new Map<number, SectorFlag & { lap: number | null }>();
  // Declared through a cast so TypeScript does not narrow it to null across loop iterations.
  let safetyCar = null as SafetyCarState;
  let red = false;

  for (const row of raceControl) {
    const at = Date.parse(row.date);
    if (at > t) break;
    if (row.scope === "Sector" && row.sector !== null) {
      if (row.flag === "YELLOW" || row.flag === "DOUBLE YELLOW") {
        // An upgrade from yellow to double yellow keeps the original time.
        const since = sectors.get(row.sector)?.since ?? at;
        sectors.set(row.sector, { sector: row.sector, flag: row.flag, since, lap: row.lap_number });
      } else if (row.flag === "CLEAR") {
        sectors.delete(row.sector);
      }
    } else if (row.scope === "Track" && (row.flag === "CLEAR" || row.flag === "GREEN")) {
      // "TRACK CLEAR" during a stoppage clears the sectors but not the stoppage itself.
      sectors.clear();
      safetyCar = null;
    } else if (row.flag === "RED" || row.message === "SESSION ABORTED") {
      // A stoppage supersedes sector flags; the feed often sends no CLEAR for them.
      sectors.clear();
      red = true;
    } else if (row.message === "SESSION STARTED") {
      sectors.clear();
      red = false;
    } else if (row.flag === "CHEQUERED" || row.message === "SESSION FINISHED") {
      // End of the session or qualifying phase. Flags raised afterwards (cool-down lap) are new.
      sectors.clear();
    } else if (row.category === "SafetyCar") {
      if (row.message.startsWith("VSC DEPLOYED")) safetyCar = { kind: "VSC", since: at, ending: false };
      else if (row.message.startsWith("SAFETY CAR DEPLOYED")) safetyCar = { kind: "SC", since: at, ending: false };
      else if (safetyCar && /ENDING|IN THIS LAP/.test(row.message)) safetyCar = { ...safetyCar, ending: true };
    }
  }

  const active = [...sectors.values()].sort((a, b) => a.since - b.since || a.sector - b.sector);
  const groups: (FlagGroup & { last: number })[] = [];
  for (const f of active) {
    const group = groups.find((g) => Math.abs(f.since - g.last) <= GROUP_WINDOW_MS && g.sectors.some((s) => Math.abs(s - f.sector) === 1));
    if (!group) {
      groups.push({ flag: f.flag, sector: f.sector, sectors: [f.sector], since: f.since, lap: f.lap, last: f.since });
      continue;
    }
    group.sectors.push(f.sector);
    group.last = f.since;
    const stronger = f.flag === "DOUBLE YELLOW" && group.flag === "YELLOW";
    if (stronger || (f.flag === group.flag && f.sector > group.sector)) group.sector = f.sector;
    if (stronger) group.flag = f.flag;
  }

  return {
    sectorFlags: active.map(({ sector, flag, since }) => ({ sector, flag, since })),
    groups: groups.map((g) => ({ flag: g.flag, sector: g.sector, sectors: [...g.sectors].sort((a, b) => a - b), since: g.since, lap: g.lap })),
    safetyCar,
    red,
  };
}

/** The race-control lines worth showing in the log, newest first. Blue flags are left out as noise. */
/** Race-control messages up to `t`, newest first, at most `limit` (Infinity for all). Blue flags are left out. */
export function logAt(raceControl: RaceControl[], t: number, limit: number): RaceControl[] {
  return raceControl
    .filter((row) => Date.parse(row.date) <= t && row.flag !== "BLUE")
    .slice(-limit)
    .reverse();
}

export type LogTone = "yellow" | "green" | "red" | "neutral";

export function logTone(row: RaceControl): LogTone {
  if (row.flag === "RED") return "red";
  if (row.flag === "YELLOW" || row.flag === "DOUBLE YELLOW" || row.category === "SafetyCar" || /^YELLOW\b/.test(row.message)) return "yellow";
  if (row.flag === "CLEAR" || row.flag === "GREEN" || /\bCLEAR$/.test(row.message)) return "green";
  return "neutral";
}

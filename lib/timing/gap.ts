/**
 * OpenF1 `intervals.gap_to_leader` and `intervals.interval` mix three shapes:
 * a number of seconds, a string such as "+1 LAP" / "+2 LAPS" for lapped cars,
 * and null for the race leader. Normalise them so the UI never has to guess.
 */
export type Gap =
  | { kind: "leader" }
  | { kind: "time"; seconds: number }
  | { kind: "laps"; laps: number }
  | { kind: "unknown"; raw: string };

const LAPS_PATTERN = /^\+?\s*(\d+)\s*LAPS?$/i;

export function parseGap(raw: number | string | null | undefined): Gap {
  if (raw === null || raw === undefined) return { kind: "leader" };
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { kind: "time", seconds: raw } : { kind: "unknown", raw: String(raw) };
  }
  const text = raw.trim();
  const laps = LAPS_PATTERN.exec(text);
  if (laps) return { kind: "laps", laps: Number(laps[1]) };
  const seconds = Number(text.replace(/^\+/, ""));
  if (text !== "" && Number.isFinite(seconds)) return { kind: "time", seconds };
  // Surface anything unexpected rather than coercing it to a number.
  return { kind: "unknown", raw: text };
}

export function formatGap(gap: Gap): string {
  switch (gap.kind) {
    case "leader":
      return "Leader";
    case "time":
      return `+${gap.seconds.toFixed(3)}`;
    case "laps":
      return `+${gap.laps} ${gap.laps === 1 ? "LAP" : "LAPS"}`;
    case "unknown":
      return gap.raw;
  }
}

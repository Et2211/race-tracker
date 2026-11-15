/** 95.587 -> "1:35.587". Null when the time is missing. */
export function formatLapTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "–";
  const ms = Math.round(seconds * 1000);
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return m > 0 ? `${m}:${s}` : ((ms % 60000) / 1000).toFixed(3);
}

/** 29.099 -> "29.099". */
export function formatSector(seconds: number | null | undefined): string {
  return seconds == null || !Number.isFinite(seconds) ? "–" : seconds.toFixed(3);
}

/** UTC clock time of an epoch-ms instant, "13:12:24". */
export function formatClock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

import type { HomeData } from "./data";

/** The first session still on or to come (a session stays "next" until 30 minutes after it ends, while it can be watched live). */
export function pickNext(meetings: HomeData["meetings"], now: number): HomeData["next"] {
  for (const m of meetings) {
    const s = m.sessions.find((x) => Date.parse(x.dateEnd) + 30 * 60_000 > now);
    if (s) return { meeting: m, session: s };
  }
  return null;
}

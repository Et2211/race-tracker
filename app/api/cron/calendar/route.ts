import { connection } from "next/server";
import { refreshCalendar } from "@/lib/session/calendar";
import { refreshSeason } from "@/lib/home/data";
import { clearDownloadedLive, fillStandings, retryMultiViewer } from "@/lib/session/maintenance";
import { prunePractice } from "@/lib/session/practice-store";
import { cronAuthorized } from "@/lib/session/cron-auth";
import { errorJson } from "@/lib/session/http";
import { supabaseConfigured } from "@/lib/storage/supabase";

export const maxDuration = 300;

/**
 * Daily: copy this season's (and, from December, next season's) schedule into the calendar, then
 * upkeep: championship tables not cached yet, live rows of sessions since downloaded, MultiViewer
 * circuit files for recent sessions that missed them, and practice replays kept over a week.
 */
export async function GET(req: Request) {
  await connection();
  if (!cronAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!supabaseConfigured()) return Response.json({ error: "Supabase is not configured" }, { status: 503 });
  try {
    const now = new Date();
    const years = [now.getUTCFullYear(), ...(now.getUTCMonth() === 11 ? [now.getUTCFullYear() + 1] : [])];
    const sessions: Record<number, number> = {};
    for (const year of years) sessions[year] = await refreshCalendar(year);
    // Upkeep; each part reports its own failure without stopping the others.
    const attempt = async <T,>(job: () => Promise<T>) => job().catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    const standings = await attempt(() => fillStandings(now.getUTCFullYear()));
    const liveCleared = await attempt(clearDownloadedLive);
    const multiviewer = await attempt(retryMultiViewer);
    const home = await attempt(() => refreshSeason(now.getUTCFullYear()));
    const practice = await attempt(() => prunePractice());
    return Response.json({ sessions, standings, liveCleared, multiviewer, home: home ?? "refreshed", practice });
  } catch (e) {
    return errorJson(e);
  }
}

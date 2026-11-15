import { connection } from "next/server";
import { refreshCalendar } from "@/lib/session/calendar";
import { cronAuthorized } from "@/lib/session/cron-auth";
import { errorJson } from "@/lib/session/http";
import { supabaseConfigured } from "@/lib/storage/supabase";

/** Daily: copy this season's (and, from December, next season's) schedule into the calendar. */
export async function GET(req: Request) {
  await connection();
  if (!cronAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!supabaseConfigured()) return Response.json({ error: "Supabase is not configured" }, { status: 503 });
  try {
    const now = new Date();
    const years = [now.getUTCFullYear(), ...(now.getUTCMonth() === 11 ? [now.getUTCFullYear() + 1] : [])];
    const sessions: Record<number, number> = {};
    for (const year of years) sessions[year] = await refreshCalendar(year);
    return Response.json({ sessions });
  } catch (e) {
    return errorJson(e);
  }
}

import { connection } from "next/server";
import { liveAllowed, liveContext, noStore, statusView, whyNotLive } from "@/lib/live/http";
import { liveMeta } from "@/lib/live/meta";
import { openf1Credentials } from "@/lib/openf1/auth";
import { errorJson } from "@/lib/session/http";

export const maxDuration = 60;

/**
 * Shared by everyone opening the session, so the CDN serves most of them: building it reads every
 * record of the session so far. The answer can be up to a minute old; the shared tick's `?after=`
 * then brings it up to date, from the same revision (and so the same, cacheable URL) for everyone
 * who got the same copy. The "not live" answers are shared for a few seconds too (a crowd
 * arriving before the start).
 */
const OPENING = { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=30" };
const NOT_LIVE = { "Cache-Control": "public, max-age=0, s-maxage=10" };

/** A live session as far as the feed has got: metadata, the revision it reflects, and the relays' status. */
export async function GET(_req: Request, ctx: RouteContext<"/api/live/[key]">) {
  await connection();
  const live = await liveContext(ctx.params);
  if (!live) return Response.json({ error: "Not a session" }, { status: 404 });
  if (!openf1Credentials()) return Response.json({ error: "Live timing isn't available right now. Replays of past sessions still work.", code: "not-configured" }, { status: 503, headers: noStore });
  if (!(await liveAllowed(live.sessionKey))) {
    const why = await whyNotLive(live.sessionKey);
    const error = why.code === "upcoming" ? "This session hasn't started yet." : why.code === "ended" ? "This session has ended." : "This session isn't live right now.";
    return Response.json({ error, ...why }, { status: 404, headers: NOT_LIVE });
  }
  try {
    const [{ meta, rev }, status] = await Promise.all([liveMeta(live.store, live.sessionKey), statusView(live.sessionKey)]);
    return Response.json({ meta, rev, status }, { headers: OPENING });
  } catch (e) {
    return errorJson(e);
  }
}

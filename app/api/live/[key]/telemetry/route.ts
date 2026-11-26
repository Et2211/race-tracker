import { connection } from "next/server";
import { liveContext, noStore } from "@/lib/live/http";
import { piece } from "@/lib/live/tick";

/** At most this many seconds per request (scrolling back loads a minute or two at a time). */
const MAX_RANGE_S = 600;

/**
 * Car positions and telemetry of a live session for the seconds in [from, to), one piece per
 * second: for opening a session or scrolling back (`&at=`: see below). Seconds arriving after
 * that come through the shared tick.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/live/[key]/telemetry">) {
  await connection();
  const live = await liveContext(ctx.params);
  if (!live) return Response.json({ error: "Not a session" }, { status: 404, headers: noStore });
  const q = new URL(req.url).searchParams;
  const from = Number(q.get("from"));
  const to = Number(q.get("to"));
  if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from || to - from > MAX_RANGE_S) {
    return Response.json({ error: `Give ?from=<s>&to=<s> at most ${MAX_RANGE_S} s apart` }, { status: 400, headers: noStore });
  }
  const rows = await live.store.bucketsBetween(live.sessionKey, from, to);
  // Viewers who got the same cached opening answer ask for the same seconds: share the answer.
  // Browsers add `&at=<revision they have read up to>`, unused here but part of the cached URL:
  // a copy is shared only by viewers at that revision, and was made after it, so it holds every
  // improvement up to it; later ones come through the tick.
  return Response.json({ chunks: rows.map((r) => piece(r.second, r.data)) }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=60" } });
}

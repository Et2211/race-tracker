import { connection } from "next/server";
import { decodeBucket } from "@/lib/live/buckets";
import { liveContext, noStore } from "@/lib/live/http";
import { LIVE_PAGE } from "@/lib/live/store";
import { encodeChunk } from "@/lib/session/telemetry";
import type { TelemetryChunk } from "@/lib/session/types";

/** At most this many seconds per range request (scrolling back loads a minute or two at a time). */
const MAX_RANGE_S = 600;

/** One stored second as a telemetry piece the dashboard loads like a stored session's window. */
function piece(second: number, data: string): TelemetryChunk {
  const b = decodeBucket(second, data);
  return encodeChunk(second, second * 1000, (second + 1) * 1000, b.location, b.carData);
}

/**
 * Car positions and telemetry of a live session, one piece per second:
 *  - `?rev=<n>`: seconds written or improved since revision n (new seconds, gaps filled from
 *    REST, partial seconds replaced by complete ones), oldest change first;
 *  - `?from=<s>&to=<s>`: the seconds in [from, to), for opening a session or scrolling back.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/live/[key]/telemetry">) {
  await connection();
  const live = await liveContext(ctx.params);
  if (!live) return Response.json({ error: "Not a session" }, { status: 404, headers: noStore });
  const q = new URL(req.url).searchParams;
  if (q.has("rev")) {
    const rev = Math.max(0, Number(q.get("rev")) || 0);
    const rows = await live.store.bucketsSince(live.sessionKey, rev);
    return Response.json(
      { chunks: rows.map((r) => piece(r.second, r.data)), rev: rows.length ? rows[rows.length - 1].rev : rev, more: rows.length === LIVE_PAGE },
      { headers: noStore },
    );
  }
  const from = Number(q.get("from"));
  const to = Number(q.get("to"));
  if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from || to - from > MAX_RANGE_S) {
    return Response.json({ error: `Give ?rev=<n>, or ?from=<s>&to=<s> at most ${MAX_RANGE_S} s apart` }, { status: 400, headers: noStore });
  }
  const rows = await live.store.bucketsBetween(live.sessionKey, from, to);
  return Response.json({ chunks: rows.map((r) => piece(r.second, r.data)) }, { headers: noStore });
}

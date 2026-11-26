import { connection } from "next/server";
import { liveContext, noStore } from "@/lib/live/http";
import { buildTick, sharedTick } from "@/lib/live/tick";
import { errorJson } from "@/lib/session/http";

/**
 * The shared live tick (lib/live/sync.ts): the same answer for every viewer of a session, so the
 * CDN answers most of them and this runs about once a second per CDN region however many watch.
 * `?after=<rev>` continues from a revision: a tick's `head` when it said `more` (shared too), or a
 * viewer's own position after it fell behind (a tab coming back, a slow connection).
 */
const SHARED = { "Cache-Control": "public, max-age=0, s-maxage=1, stale-while-revalidate=1" };

export async function GET(req: Request, ctx: RouteContext<"/api/live/[key]/tick">) {
  await connection();
  const live = await liveContext(ctx.params);
  if (!live) return Response.json({ error: "Not a session" }, { status: 404, headers: noStore });
  const q = new URL(req.url).searchParams.get("after");
  const after = q === null ? null : Number(q);
  if (after !== null && !(Number.isSafeInteger(after) && after >= 0)) return Response.json({ error: "Give ?after=<revision>" }, { status: 400, headers: noStore });
  try {
    return Response.json(await (after === null ? sharedTick(live.store, live.sessionKey) : buildTick(live.store, live.sessionKey, after)), { headers: SHARED });
  } catch (e) {
    return errorJson(e);
  }
}

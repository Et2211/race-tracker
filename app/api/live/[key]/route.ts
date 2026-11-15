import { connection } from "next/server";
import { liveContext, noStore, statusView } from "@/lib/live/http";
import { liveMeta } from "@/lib/live/meta";
import { openf1Credentials } from "@/lib/openf1/auth";
import { errorJson } from "@/lib/session/http";

export const maxDuration = 60;

/** A live session as far as the feed has got: metadata, the revision it reflects, and the relays' status. */
export async function GET(_req: Request, ctx: RouteContext<"/api/live/[key]">) {
  await connection();
  const live = await liveContext(ctx.params);
  if (!live) return Response.json({ error: "Not a session" }, { status: 404 });
  if (!openf1Credentials()) return Response.json({ error: "Live data is not set up: the server has no OpenF1 account (the paid tier). Replays of past sessions work as usual.", code: "not-configured" }, { status: 503, headers: noStore });
  try {
    const [{ meta, rev }, status] = await Promise.all([liveMeta(live.store, live.sessionKey), statusView(live.sessionKey)]);
    return Response.json({ meta, rev, status }, { headers: noStore });
  } catch (e) {
    return errorJson(e);
  }
}

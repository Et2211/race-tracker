import { connection } from "next/server";
import { liveContext, noStore, statusView } from "@/lib/live/http";
import { LIVE_PAGE } from "@/lib/live/store";

/** Rows that changed since `?rev=`, oldest change first, and the relays' status. Polled every second. */
export async function GET(req: Request, ctx: RouteContext<"/api/live/[key]/updates">) {
  await connection();
  const live = await liveContext(ctx.params);
  if (!live) return Response.json({ error: "Not a session" }, { status: 404 });
  const rev = Math.max(0, Number(new URL(req.url).searchParams.get("rev")) || 0);
  const [rows, status] = await Promise.all([live.store.rowsSince(live.sessionKey, rev), statusView(live.sessionKey)]);
  return Response.json(
    { rows: rows.map(({ topic, payload }) => ({ topic, payload })), rev: rows.length ? rows[rows.length - 1].rev : rev, more: rows.length === LIVE_PAGE, status },
    { headers: noStore },
  );
}

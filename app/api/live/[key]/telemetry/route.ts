import { connection } from "next/server";
import { decodeBucket } from "@/lib/live/buckets";
import { liveContext, noStore } from "@/lib/live/http";
import type { CarDataRow, LocationRow } from "@/lib/openf1/types";
import { encodeChunk } from "@/lib/session/telemetry";

/**
 * One minute of car positions and telemetry (`?minute=` = epoch minutes), in the same format as a
 * stored session's windows, so the dashboard loads it the same way. `to` is where the data ends
 * so far, so a minute still being written is fetched again.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/live/[key]/telemetry">) {
  await connection();
  const live = await liveContext(ctx.params);
  if (!live) return Response.json({ error: "Not a session" }, { status: 404 });
  const minute = Number(new URL(req.url).searchParams.get("minute"));
  if (!Number.isInteger(minute) || minute <= 0) return Response.json({ error: "Give ?minute=<epoch minutes>" }, { status: 400 });
  const buckets = await live.store.bucketsBetween(live.sessionKey, minute * 60, minute * 60 + 60);
  const location: LocationRow[] = [];
  const carData: CarDataRow[] = [];
  for (const b of buckets) {
    const d = decodeBucket(b.second, b.data);
    location.push(...d.location);
    carData.push(...d.carData);
  }
  const from = minute * 60_000;
  const to = buckets.length ? (buckets[buckets.length - 1].second + 1) * 1000 : from;
  return Response.json(encodeChunk(minute, from, to, location, carData), { headers: noStore });
}

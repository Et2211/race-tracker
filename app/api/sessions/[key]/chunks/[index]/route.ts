import { errorJson, gzipJson, parseKey } from "@/lib/session/http";
import { ensureChunk, storedChunk } from "@/lib/session/source";

// One 15-minute window: two OpenF1 requests of up to ~10 MB each.
export const maxDuration = 300;

/** One telemetry window. Read-through: downloaded from OpenF1 and stored on first request. */
export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[key]/chunks/[index]">) {
  const { key, index } = await ctx.params;
  const k = parseKey(key);
  const i = /^\d{1,3}$/.test(index) ? Number(index) : null;
  if (k === null || i === null) return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    let raw = await storedChunk(k, i);
    if (!raw) {
      await ensureChunk(k, i);
      raw = await storedChunk(k, i);
    }
    return raw ? gzipJson(raw, "immutable") : Response.json({ error: "Stored chunk is missing" }, { status: 500 });
  } catch (e) {
    return errorJson(e);
  }
}

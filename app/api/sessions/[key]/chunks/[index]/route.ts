import { gzipSync } from "node:zlib";
import { badRequest, errorJson, storedJson, parseKey } from "@/lib/session/http";
import { ensureChunk, storedChunk } from "@/lib/session/source";

// One 15-minute window: two OpenF1 requests of up to ~10 MB each.
export const maxDuration = 300;

/** One telemetry window. Read-through: downloaded from OpenF1 and stored on first request. */
export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[key]/chunks/[index]">) {
  const { key, index } = await ctx.params;
  const k = parseKey(key);
  const i = /^\d{1,3}$/.test(index) ? Number(index) : null;
  if (k === null || i === null) return badRequest("Bad request");
  try {
    const raw = (await storedChunk(k, i)) ?? gzipSync(JSON.stringify(await ensureChunk(k, i)));
    return await storedJson(raw, "immutable");
  } catch (e) {
    return errorJson(e);
  }
}

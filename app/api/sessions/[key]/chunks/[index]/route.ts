import { gzipSync } from "node:zlib";
import { badRequest, errorJson, parseKey, storedJson, unknownSession } from "@/lib/session/http";
import { builtProvisionally, ensureChunk, isKnownSession, storedChunk } from "@/lib/session/source";

// One 15-minute window: two OpenF1 requests of up to ~10 MB each.
export const maxDuration = 300;

/** One telemetry window. Read-through: downloaded from OpenF1 and stored on first request. */
export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[key]/chunks/[index]">) {
  const { key, index } = await ctx.params;
  const k = parseKey(key);
  const i = /^\d{1,3}$/.test(index) ? Number(index) : null;
  if (k === null || i === null) return badRequest("Bad request");
  try {
    const stored = await storedChunk(k, i);
    if (!stored && !(await isKnownSession(k))) return unknownSession();
    const raw = stored ?? gzipSync(JSON.stringify(await ensureChunk(k, i)));
    // Practice built before OpenF1 has settled isn't kept anywhere for long; everything else never changes.
    const res = await storedJson(raw, !stored && builtProvisionally(k) ? "provisional" : "immutable");
    // Where it came from, so the browser knows whether asking for several at once is cheap
    // (stored) or would queue behind OpenF1's rate limit (downloaded just now).
    res.headers.set("x-data-source", stored ? "store" : "openf1");
    return res;
  } catch (e) {
    return errorJson(e);
  }
}

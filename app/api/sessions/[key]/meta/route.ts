import { gzipSync } from "node:zlib";
import { badRequest, errorJson, storedJson, parseKey } from "@/lib/session/http";
import { ensureMeta, storedMeta } from "@/lib/session/source";

// Downloading metadata is about 15 OpenF1 requests at the free tier's pace (~35 s).
export const maxDuration = 300;

/**
 * The session's metadata. Read-through: if it has not been downloaded yet, it is fetched from
 * OpenF1 and stored first, so the first request for a session takes about 30 seconds.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[key]/meta">) {
  const key = parseKey((await ctx.params).key);
  if (key === null) return badRequest("Bad session key");
  try {
    // Gzipped either way: the plain JSON can exceed Vercel's 4.5 MB response limit. After a first
    // download, send what was just built rather than reading it back from storage.
    const raw = (await storedMeta(key)) ?? gzipSync(JSON.stringify(await ensureMeta(key)));
    return await storedJson(raw, "meta");
  } catch (e) {
    return errorJson(e);
  }
}

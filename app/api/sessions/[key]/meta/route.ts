import { errorJson, gzipJson, parseKey } from "@/lib/session/http";
import { ensureMeta, storedMeta } from "@/lib/session/source";

// Downloading metadata is about 15 OpenF1 requests at the free tier's pace (~35 s).
export const maxDuration = 300;

/**
 * The session's metadata. Read-through: if it has not been downloaded yet, it is fetched from
 * OpenF1 and stored first, so the first request for a session takes about 30 seconds.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[key]/meta">) {
  const key = parseKey((await ctx.params).key);
  if (key === null) return Response.json({ error: "Bad session key" }, { status: 400 });
  try {
    let raw = await storedMeta(key);
    if (!raw) {
      await ensureMeta(key);
      raw = await storedMeta(key);
    }
    // Send the stored gzip: the plain JSON can exceed Vercel's 4.5 MB response limit.
    return raw ? gzipJson(raw, "day") : Response.json({ error: "Stored metadata is missing" }, { status: 500 });
  } catch (e) {
    return errorJson(e);
  }
}

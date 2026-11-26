import { badRequest, errorJson, parseKey, unknownSession } from "@/lib/session/http";
import { circuitCorners, isKnownSession, storedMeta } from "@/lib/session/source";

/** The circuit's numbered turns for a session, from MultiViewer's circuit file (see `circuitCorners`). */
export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[key]/corners">) {
  const key = parseKey((await ctx.params).key);
  if (key === null) return badRequest("Bad session key");
  // A listed session, or one stored before it stopped being listed; nothing else is looked up.
  if (!(await isKnownSession(key)) && !(await storedMeta(key))) return unknownSession();
  try {
    // Circuit files change rarely: an hour in the browser, a day at the CDN. A lookup that failed
    // for now (MultiViewer unreachable) is not cached, so the next request tries again.
    const { corners, final } = await circuitCorners(key);
    return Response.json(corners, { headers: { "cache-control": final ? "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" : "no-store" } });
  } catch (e) {
    return errorJson(e);
  }
}

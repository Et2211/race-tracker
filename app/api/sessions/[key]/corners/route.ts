import { badRequest, errorJson, parseKey } from "@/lib/session/http";
import { circuitCorners } from "@/lib/session/source";

/** The circuit's numbered turns for a session, from MultiViewer's circuit file (see `circuitCorners`). */
export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[key]/corners">) {
  const key = parseKey((await ctx.params).key);
  if (key === null) return badRequest("Bad session key");
  try {
    // Circuit files change rarely: an hour in the browser, a day at the CDN.
    return Response.json(await circuitCorners(key), { headers: { "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" } });
  } catch (e) {
    return errorJson(e);
  }
}

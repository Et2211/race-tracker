import { FIRST_YEAR } from "@/lib/session/catalog";
import { errorJson } from "@/lib/session/http";
import { getCatalog } from "@/lib/session/source";

export async function GET(_req: Request, ctx: RouteContext<"/api/catalog/[year]">) {
  const year = Number((await ctx.params).year);
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > new Date().getUTCFullYear()) {
    return Response.json({ error: "Unknown season" }, { status: 404 });
  }
  try {
    return Response.json(await getCatalog(year));
  } catch (e) {
    return errorJson(e);
  }
}

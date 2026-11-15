import { connection } from "next/server";
import { FIRST_YEAR } from "@/lib/session/catalog";

/** Seasons the picker offers, newest first. Computed per request so a new season appears on 1 January. */
export async function GET() {
  await connection();
  const latest = new Date().getUTCFullYear();
  return Response.json({ years: Array.from({ length: latest - FIRST_YEAR + 1 }, (_, i) => latest - i) });
}

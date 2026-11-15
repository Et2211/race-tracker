import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Scheduled jobs call the app with `Authorization: Bearer <CRON_SECRET>`. Without the secret set,
 * the endpoints are closed.
 */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

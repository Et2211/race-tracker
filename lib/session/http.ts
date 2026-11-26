import "server-only";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { DownloadBusyError } from "@/lib/storage/download-lock";
import { StorageFullError } from "@/lib/storage/session-index";
import { NotReadyError } from "./ingest";
import { RateLimitedError } from "@/lib/openf1/client";

const gunzipAsync = promisify(gunzip);

/**
 * Serve stored gzipped JSON, unpacked: the platform compresses responses for the wire itself.
 * (Next.js 16.4.6 drops a route's own content-encoding header, so gzip bytes sent as they are
 * would reach the browser as unreadable JSON.) Responses are public, so Vercel's
 * CDN can serve repeat requests without reading Supabase again (the data is public anyway).
 *  - Telemetry windows never change: a year, everywhere.
 *  - Metadata can be rewritten (learned marshal sectors, a backfill): 5 minutes in the browser, an
 *    hour at the CDN, then served stale while refreshed.
 * URLs carry the data format version, so a format change never reads a stale copy.
 */
export async function storedJson(body: Buffer, cache: "meta" | "immutable" | "provisional"): Promise<Response> {
  return new Response(new Uint8Array(await gunzipAsync(body)), {
    headers: {
      "content-type": "application/json",
      "cache-control": CACHE[cache],
    },
  });
}

const CACHE = {
  immutable: "public, max-age=31536000, s-maxage=31536000, immutable",
  meta: "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
  /** Practice built before OpenF1 has settled: shared for a minute, so nobody keeps an incomplete copy. */
  provisional: "public, max-age=0, s-maxage=60",
} as const;

/** Errors are never cached: the next request should try again. */
const noStore = { "Cache-Control": "no-store" };

export function errorJson(e: unknown): Response {
  if (e instanceof DownloadBusyError) return Response.json({ error: e.message, code: "busy" }, { status: 503, headers: { ...noStore, "Retry-After": "30" } });
  if (e instanceof NotReadyError) return Response.json({ error: e.message, code: "not-ready" }, { status: 409, headers: noStore });
  if (e instanceof StorageFullError) return Response.json({ error: e.message, code: "storage-full" }, { status: 507, headers: noStore });
  if (e instanceof RateLimitedError) return Response.json({ error: e.message, code: "rate-limited" }, { status: 429, headers: noStore });
  console.error(e);
  return Response.json({ error: e instanceof Error ? e.message : "Unexpected error", code: "failed" }, { status: 502, headers: noStore });
}

/**
 * A session the app does not list: answered without asking OpenF1, and shared by the CDN for a
 * few minutes so a script trying numbers costs the server little.
 */
export function unknownSession(): Response {
  return Response.json({ error: "There is no such session.", code: "unknown" }, { status: 404, headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } });
}

/** A request the server will not answer (bad key): not cached either. */
export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400, headers: noStore });
}

export function parseKey(value: string): number | null {
  return /^\d{1,7}$/.test(value) ? Number(value) : null;
}

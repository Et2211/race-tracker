import "server-only";
import { DownloadBusyError } from "@/lib/storage/download-lock";
import { StorageFullError } from "@/lib/storage/session-index";
import { NotReadyError } from "./ingest";
import { RateLimitedError } from "@/lib/openf1/client";

/**
 * Serve stored gzipped JSON as-is; the browser decompresses it. Responses are public, so Vercel's
 * CDN can serve repeat requests without reading Supabase again (the data is public anyway).
 *  - Telemetry windows never change: a year, everywhere.
 *  - Metadata can be rewritten (learned marshal sectors, a backfill): 5 minutes in the browser, an
 *    hour at the CDN, then served stale while refreshed.
 * URLs carry the data format version, so a format change never reads a stale copy.
 */
export function gzipJson(body: Buffer, cache: "meta" | "immutable"): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/json",
      "content-encoding": "gzip",
      "cache-control": cache === "immutable" ? "public, max-age=31536000, s-maxage=31536000, immutable" : "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

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

/** A request the server will not answer (bad key): not cached either. */
export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400, headers: noStore });
}

export function parseKey(value: string): number | null {
  return /^\d{1,7}$/.test(value) ? Number(value) : null;
}

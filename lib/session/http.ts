import "server-only";
import { NotReadyError, StorageFullError } from "./ingest";
import { RateLimitedError } from "@/lib/openf1/client";

/**
 * Serve stored gzipped JSON as-is; the browser decompresses it. Past sessions do not change, so
 * telemetry windows may be cached by the browser for a year. Metadata is cached for a day because
 * learned marshal-sector positions are applied when it is served. URLs carry the data format
 * version, so a format change never reads a stale copy.
 */
export function gzipJson(body: Buffer, cache: "day" | "immutable"): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/json",
      "content-encoding": "gzip",
      "cache-control": cache === "immutable" ? "private, max-age=31536000, immutable" : "private, max-age=86400",
    },
  });
}

export function errorJson(e: unknown): Response {
  if (e instanceof NotReadyError) return Response.json({ error: e.message, code: "not-ready" }, { status: 409 });
  if (e instanceof StorageFullError) return Response.json({ error: e.message, code: "storage-full" }, { status: 507 });
  if (e instanceof RateLimitedError) return Response.json({ error: e.message, code: "rate-limited" }, { status: 429 });
  console.error(e);
  return Response.json({ error: e instanceof Error ? e.message : "Unexpected error", code: "failed" }, { status: 502 });
}

export function parseKey(value: string): number | null {
  return /^\d{1,7}$/.test(value) ? Number(value) : null;
}

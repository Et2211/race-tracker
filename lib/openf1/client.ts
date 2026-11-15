import "server-only";

/**
 * Server-side OpenF1 client. Historical data needs no credentials. Requests are spaced to stay
 * under the free tier's 3 per second and 30 per minute (per server instance), empty results
 * (HTTP 404 "No results found.") become empty arrays, and 429/5xx are retried with backoff.
 */

const BASE = process.env.OPENF1_API_BASE ?? "https://api.openf1.org/v1";
const MIN_GAP_MS = 2100;
let nextSlot = 0;

export class TooMuchDataError extends Error {}
export class RateLimitedError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait for this instance's next free request slot. */
async function slot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) await sleep(at - now);
}

type Params = Record<string, string | number>;

/** Build a query string. Keys may end in an operator, e.g. { "date>=": "2026-09-13T13:00:00Z" }. */
export function query(params: Params): string {
  return Object.entries(params)
    .map(([key, value]) => {
      const m = /^(.*?)(>=|<=|>|<)?$/.exec(key)!;
      return `${encodeURIComponent(m[1])}${m[2] ?? "="}${encodeURIComponent(String(value))}`;
    })
    .join("&");
}

export async function openf1<T>(endpoint: string, params: Params = {}, attempts = 5): Promise<T[]> {
  const url = `${BASE}/${endpoint}?${query(params)}`;
  for (let attempt = 0; ; attempt++) {
    await slot();
    const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (res.status === 404) return []; // OpenF1's way of saying "no rows"
    if (res.status === 422) throw new TooMuchDataError(`OpenF1 refused ${endpoint}: too much data in one request`);
    if (res.status === 429 || res.status >= 500) {
      if (attempt + 1 >= attempts) {
        if (res.status === 429) throw new RateLimitedError("OpenF1 rate limit reached; try again in a minute");
        throw new Error(`OpenF1 ${res.status} for ${endpoint}`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`OpenF1 ${res.status} for ${endpoint}: ${(await res.text()).slice(0, 200)}`);
    const data: unknown = await res.json();
    if (!Array.isArray(data)) throw new Error(`OpenF1 returned a non-list for ${endpoint}`);
    return data as T[];
  }
}

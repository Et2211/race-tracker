import "server-only";

import { supabase, supabaseConfigured } from "@/lib/storage/supabase";
import { accessToken, BASE, dropToken, openf1Credentials } from "./auth";
import { BackgroundGate } from "./lanes";

/**
 * Server-side OpenF1 client. Historical data needs no credentials. OpenF1 allows 3 requests a
 * second and 30 a minute, or with an account (OPENF1_USERNAME and OPENF1_PASSWORD) 6 and 60, for
 * the whole account. Every server instance takes its turn from one shared schedule in Supabase
 * (openf1_grant()), kept a little under those limits; without Supabase, or if it cannot be
 * reached, each instance spaces its own requests instead. Empty results (HTTP 404 "No results
 * found.") become empty arrays. Rate limits, server errors, network failures and requests that
 * hang are retried with growing, jittered waits.
 */

const withAccount = openf1Credentials() !== null;
/** The shared schedule's budget: a margin under OpenF1's limits for clock skew and stray scripts. */
const SHARED = withAccount ? { perMinute: 50, gapMs: 200 } : { perMinute: 25, gapMs: 500 };
/** Fallback spacing for one instance on its own: under the per-minute limit by itself. */
const MIN_GAP_MS = withAccount ? 1050 : 2100;
/** A response (headers and body) taking longer than this is given up on and retried. */
const TIMEOUT_MS = 60_000;

let nextSlot = 0;
/** After a 429, this instance holds back every request until then, whatever the schedule says. */
let backoffUntil = 0;

export class TooMuchDataError extends Error {}
export class RateLimitedError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** ±25%, so instances that failed together do not all retry together. */
const jitter = (ms: number) => Math.round(ms * (0.75 + Math.random() * 0.5));

/**
 * When the shared schedule says to send (epoch ms); null if there is none or it cannot be reached.
 * A time, not a wait: waits would start when each answer arrives, and round trips differ.
 */
async function sharedSendAt(): Promise<number | null> {
  if (!supabaseConfigured()) return null;
  try {
    const { data, error } = await supabase().rpc("openf1_grant", { p_per_minute: SHARED.perMinute, p_min_gap_ms: SHARED.gapMs });
    const at = Number(data);
    return error || !Number.isFinite(at) ? null : at;
  } catch {
    return null;
  }
}

/** Wait for this request's turn. */
async function slot() {
  const shared = await sharedSendAt();
  const now = Date.now();
  let at: number;
  if (shared === null) {
    at = Math.max(now, nextSlot, backoffUntil);
    nextSlot = at + MIN_GAP_MS;
  } else {
    at = Math.max(shared, backoffUntil);
  }
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

/** Spacing of this instance's background requests while a session is live (see lanes.ts). */
const BACKGROUND_GAP_MS = 1500;
const gate = new BackgroundGate(BACKGROUND_GAP_MS);

/** Whether a session is on now (the calendar's live window), asked at most every 30 s; false without Supabase. */
let liveCache: { at: number; value: Promise<boolean> } | null = null;
function liveNow(): Promise<boolean> {
  if (!supabaseConfigured()) return Promise.resolve(false);
  if (!liveCache || Date.now() - liveCache.at > 30_000) {
    const value = Promise.resolve(supabase().rpc("live_session_now")).then(
      ({ data, error }) => !error && Array.isArray(data) && data.length > 0,
      () => false,
    );
    liveCache = { at: Date.now(), value };
  }
  return liveCache.value;
}

/**
 * A request for anything but live timing: downloads, calendars, standings. While a session is
 * live these go out one at a time per instance, so they never queue ahead of the live relay.
 */
export async function openf1<T>(endpoint: string, params: Params = {}, attempts = 5): Promise<T[]> {
  return gate.run(await liveNow(), () => request<T>(endpoint, params, attempts));
}

/** A request for live timing (the relay filling a gap, a live session opening): never held back. */
export function openf1Live<T>(endpoint: string, params: Params = {}, attempts = 5): Promise<T[]> {
  return request<T>(endpoint, params, attempts);
}

async function request<T>(endpoint: string, params: Params, attempts: number): Promise<T[]> {
  const url = `${BASE}/${endpoint}?${query(params)}`;
  for (let attempt = 0; ; attempt++) {
    const last = attempt + 1 >= attempts;
    const backoff = jitter(3000 * 2 ** attempt); // 3, 6, 12, 24 s
    await slot();
    const token = await accessToken();
    let res: Response;
    let data: unknown;
    try {
      res = await fetch(url, {
        headers: { accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) data = await res.json(); // the body is covered by the timeout too
    } catch (e) {
      // Network failure (DNS, reset connection) or no answer in time: worth another go.
      const reason = e instanceof Error && e.name === "TimeoutError" ? `no answer in ${TIMEOUT_MS / 1000} s` : e instanceof Error ? e.message : String(e);
      if (last) throw new Error(`OpenF1 unreachable for ${endpoint}: ${reason}`);
      await sleep(backoff);
      continue;
    }
    if (res.status === 401 && token && !last) {
      dropToken(); // expired early or revoked: sign in again
      continue;
    }
    if (res.status === 404) return []; // OpenF1's way of saying "no rows"
    if (res.status === 422) throw new TooMuchDataError(`OpenF1 refused ${endpoint}: too much data in one request`);
    if (res.status === 429 || res.status >= 500) {
      if (last) {
        if (res.status === 429) throw new RateLimitedError("OpenF1 rate limit reached; try again in a minute");
        throw new Error(`OpenF1 ${res.status} for ${endpoint}`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff;
      // Hold back every other request from this instance too, not just this one.
      if (res.status === 429) backoffUntil = Math.max(backoffUntil, Date.now() + wait);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`OpenF1 ${res.status} for ${endpoint}: ${(await res.text()).slice(0, 200)}`);
    if (!Array.isArray(data)) throw new Error(`OpenF1 returned a non-list for ${endpoint}`);
    return data as T[];
  }
}

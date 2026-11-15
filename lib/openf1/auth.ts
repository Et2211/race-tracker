import "server-only";

/**
 * OpenF1 accounts (the paid tier: real-time data, higher limits). The username and password stay
 * on the server; they are exchanged for a bearer token that lasts an hour
 * (https://openf1.org/auth.html), which is also the MQTT password.
 */
export const BASE = process.env.OPENF1_API_BASE ?? "https://api.openf1.org/v1";

export function openf1Credentials(): { username: string; password: string } | null {
  const username = process.env.OPENF1_USERNAME;
  const password = process.env.OPENF1_PASSWORD;
  return username && password ? { username, password } : null;
}

let cached: { token: string; expiresAt: number } | null = null;
let pending: Promise<string> | null = null;

/**
 * A current access token, or null without credentials. Renewed when it has less than
 * `validForMs` left (a minute by default; a relay asks for its whole lifetime, so a reconnect
 * near its end does not present an expired token).
 */
export async function accessToken(validForMs = 60_000): Promise<string | null> {
  const credentials = openf1Credentials();
  if (!credentials) return null;
  if (cached && cached.expiresAt - validForMs > Date.now()) return cached.token;
  pending ??= (async () => {
    const res = await fetch(new URL("/token", BASE), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(credentials),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`OpenF1 sign-in failed (${res.status}). Check OPENF1_USERNAME and OPENF1_PASSWORD.`);
    const body = (await res.json()) as { access_token?: string; expires_in?: string | number };
    if (!body.access_token) throw new Error("OpenF1 sign-in returned no token");
    const seconds = Number(body.expires_in);
    cached = { token: body.access_token, expiresAt: Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000 };
    return cached.token;
  })().finally(() => {
    pending = null;
  });
  return pending;
}

/** Forget the token (after a 401), so the next call signs in again. */
export function dropToken() {
  cached = null;
}

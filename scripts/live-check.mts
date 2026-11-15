/**
 * Day-one check for an OpenF1 account: signs in, listens to the real-time feed and reports what
 * arrives. Prints topics, message counts and one example message per topic; never the token.
 *
 *   npm run live:check [-- --seconds 60]
 *
 * Uses OPENF1_USERNAME / OPENF1_PASSWORD (and OPENF1_API_BASE / OPENF1_MQTT_URL if set) from .env.local.
 * Outside a live session the feed is quiet; that is expected.
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { accessToken, openf1Credentials, BASE } = await import("@/lib/openf1/auth");
const { connectFeed, MQTT_URLS } = await import("@/lib/live/relay");

const i = process.argv.indexOf("--seconds");
const seconds = i >= 0 ? Number(process.argv[i + 1]) : 60;
const credentials = openf1Credentials();
if (!credentials) throw new Error("Set OPENF1_USERNAME and OPENF1_PASSWORD in .env.local");

console.log(`Signing in at ${new URL("/token", BASE)} …`);
const token = await accessToken();
console.log("Signed in: got a token.");

const rest = await fetch(`${BASE}/sessions?session_key=latest`, { headers: { Authorization: `Bearer ${token}` } });
console.log(`REST with the token: HTTP ${rest.status}`);

console.log(`Connecting (trying ${MQTT_URLS.join(", then ")}) …`);
const { client, url } = await connectFeed({ username: credentials.username, password: token!, reconnectPeriod: 0 }, 15_000, (line) => console.log(`  ${line}`));
console.log(`Connected over ${url}; listening for ${seconds} s …`);
await client.subscribeAsync("#");
const counts = new Map<string, number>();
const examples = new Map<string, string>();
client.on("message", (topic, buf) => {
  counts.set(topic, (counts.get(topic) ?? 0) + 1);
  if (!examples.has(topic)) examples.set(topic, buf.toString("utf8").slice(0, 300));
});
await new Promise((r) => setTimeout(r, seconds * 1000));
await client.endAsync();

if (counts.size === 0) console.log("No messages. Normal outside a live session; during one, check the account has real-time access.");
for (const [topic, n] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`\n${topic}: ${n} messages (${(n / seconds).toFixed(1)}/s)`);
  console.log(`  e.g. ${examples.get(topic)}`);
}

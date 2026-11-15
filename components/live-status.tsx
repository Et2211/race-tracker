import type { LiveStatusView } from "@/lib/live/http";
import { formatClock } from "@/lib/timing/format";

/** Whether the live feed is arriving, and how far behind the newest data the dashboard is. */
export function LiveStatusLine({ status, behind, synced, onCatchUp }: { status: LiveStatusView | null; behind: number; synced: boolean; onCatchUp: () => void }) {
  let text: string;
  let tone: "ok" | "warn" | "off" = "ok";
  if (!status) {
    text = "Connecting…";
    tone = "off";
  } else if (!status.configured) {
    text = "Live data is not set up: the server has no OpenF1 account.";
    tone = "off";
  } else if (status.relaysAlive > 0) {
    text = `Connected${status.lastSecond !== null ? ` · data to ${formatClock((status.lastSecond + 1) * 1000)} UTC` : " · waiting for the first data"}`;
  } else if (status.lastSeen) {
    const ago = Math.round((status.now - Date.parse(status.lastSeen)) / 1000);
    text = `No feed for ${ago} s${status.lastSecond !== null ? ` · data to ${formatClock((status.lastSecond + 1) * 1000)} UTC` : ""}. Relays start every minute while a session is on.`;
    tone = "warn";
  } else {
    text = "Waiting for the feed. Relays start every minute from 20 minutes before a session.";
    tone = "off";
  }
  const seconds = Math.round(behind / 1000);
  return (
    <div role="status" className={`live-status ${tone}`}>
      <span className="live-dot" aria-hidden="true" />
      <strong>Live</strong>
      <span className="muted">{text}</span>
      {seconds >= 3 && (
        <span className="muted">
          · showing {seconds} s behind {synced ? "the data (synced to your stream)" : "the newest data"}{" "}
          <button className="seg" onClick={onCatchUp}>{synced ? "Back to your stream" : "Back to live"}</button>
        </span>
      )}
    </div>
  );
}

import type { LiveStatusView } from "@/lib/live/http";

/** Whether the live feed is arriving, and how far behind the newest data the dashboard is. */
export function LiveStatusLine({ status, behind, synced, following, onCatchUp }: { status: LiveStatusView | null; behind: number; synced: boolean; following: boolean; onCatchUp: () => void }) {
  let text: string;
  let tone: "ok" | "warn" | "off" = "ok";
  if (!status) {
    text = "Connecting…";
    tone = "off";
  } else if (!status.configured) {
    text = "Live timing isn't available right now.";
    tone = "off";
  } else if (status.relaysAlive > 0) {
    text = status.lastSecond !== null ? "" : "Waiting for the first data";
  } else if (status.lastSeen) {
    const ago = Math.round((status.now - Date.parse(status.lastSeen)) / 1000);
    text = `Reconnecting… (no data for ${ago} s)`;
    tone = "warn";
  } else {
    text = "Waiting for the session to start";
    tone = "off";
  }
  const seconds = Math.round(behind / 1000);
  return (
    <div role="status" className={`live-status ${tone}`}>
      <span className="live-dot" aria-hidden="true" />
      <strong>Live</strong>
      <span className="muted">{text}</span>
      {!following && seconds >= 3 && (
        <span className="muted">
          · {seconds} s behind{synced ? " (synced to your stream)" : ""}{" "}
          <button className="seg" onClick={onCatchUp}>{synced ? "Back to your stream" : "Back to live"}</button>
        </span>
      )}
    </div>
  );
}

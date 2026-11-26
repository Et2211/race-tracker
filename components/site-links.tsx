import Link from "next/link";

/** Where to send feedback: the public repository's issues (needs a GitHub account). */
export const REPORT_URL = "https://github.com/Et2211/race-tracker/issues/new";

/** The footer's links, after its own text. */
export function SiteLinks() {
  return (
    <span className="site-links">
      <a href={REPORT_URL} target="_blank" rel="noopener noreferrer">Report a problem</a>
      {" · "}
      <Link href="/privacy">Privacy</Link>
    </span>
  );
}

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page">
      <header className="masthead">
        <div>
          <div className="hd" style={{ color: "var(--red-text)" }}><Link href="/" className="home-link">Speed Trace</Link></div>
          <h1>Page not found</h1>
          <p>There is nothing at this address.</p>
        </div>
      </header>
      <main className="page-main">
        <section className="panel">
          <Link href="/" className="tab" style={{ alignSelf: "flex-start" }}>← All sessions</Link>
        </section>
      </main>
    </div>
  );
}

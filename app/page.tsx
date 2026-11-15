import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { SeasonCalendar } from "@/components/home/calendar";
import { LatestRace } from "@/components/home/latest-race";
import { NextSession } from "@/components/home/next-session";
import { PointsChart } from "@/components/home/points-chart";
import { Standings } from "@/components/home/standings";
import { getHomeData } from "@/lib/home/data";
import { FIRST_YEAR } from "@/lib/session/catalog";

async function Season({ searchParams }: PageProps<"/">) {
  await connection();
  const latestYear = new Date().getUTCFullYear();
  const asked = Number((await searchParams).season);
  const year = Number.isInteger(asked) && asked >= FIRST_YEAR && asked <= latestYear ? asked : latestYear;
  const years = Array.from({ length: latestYear - FIRST_YEAR + 1 }, (_, i) => latestYear - i);

  let data;
  try {
    data = await getHomeData(year);
  } catch (e) {
    return (
      <section className="panel" role="alert">
        <h2>Could not load the {year} season</h2>
        <p className="note">{e instanceof Error ? e.message : String(e)}</p>
      </section>
    );
  }
  const mb = (n: number) => Math.round(n / 1048576);
  const champion = data.standings?.drivers[0] ?? null;

  return (
    <>
      <nav aria-label="Season" className="seasons">
        {years.map((y) => (
          <Link key={y} href={y === latestYear ? "/" : `/?season=${y}`} className="tab" aria-current={y === year ? "page" : undefined}>{y}</Link>
        ))}
      </nav>
      <div className="row">
        {data.next ? (
          <NextSession next={data.next} meetings={data.meetings} />
        ) : (
          <section className="panel hero">
            <div className="hero-copy">
              <div className="hd" style={{ color: "var(--red-text)" }}>{year} season</div>
              {champion ? (
                <>
                  <h2 className="hero-title">
                    {champion.fullName || champion.name || champion.code} <span className="hero-num">#{champion.driver}</span>
                  </h2>
                  <p className="hero-sub">{year} world champion · {champion.points} points{champion.team ? ` · ${champion.team}` : ""}</p>
                </>
              ) : (
                <h2 className="hero-title">Season complete</h2>
              )}
              <p className="muted" style={{ margin: 0 }}>{data.meetings.filter((m) => !m.cancelled).length} rounds{data.standings?.teams[0] ? ` · ${data.standings.teams[0].team} won the constructors' championship` : ""}</p>
            </div>
          </section>
        )}
        {data.latest && <LatestRace latest={data.latest} />}
      </div>
      <SeasonCalendar data={data} />
      {data.standings ? (
        <>
          <Standings standings={data.standings} />
          {data.progression && <PointsChart progression={data.progression} year={year} />}
        </>
      ) : (
        <section className="panel">
          <h2>Championship</h2>
          <p className="note">{data.source === "fixtures" ? "Standings come from OpenF1 and are not available in offline mode." : "No standings yet for this season."}</p>
        </section>
      )}
      {data.storage && (
        <section className="panel storage" aria-labelledby="storage-title">
          <div className="split">
            <h2 id="storage-title" className="small">Stored sessions</h2>
            <span className="muted" style={{ fontSize: 14 }}>{data.storage.sessions} sessions · {mb(data.storage.bytes)} MB of the {mb(data.storage.capBytes)} MB cap</span>
          </div>
          <div className="gauge" role="meter" aria-valuemin={0} aria-valuemax={data.storage.capBytes} aria-valuenow={data.storage.bytes} aria-label="Storage used">
            <div style={{ width: `${Math.min(100, (data.storage.bytes / data.storage.capBytes) * 100)}%` }} />
          </div>
          <p className="note">Downloads stop at the cap, which keeps the free 1 GB of Supabase storage from filling up.</p>
        </section>
      )}
    </>
  );
}

export default function Home(props: PageProps<"/">) {
  return (
    <div className="page">
      <header className="masthead">
        <div>
          <div className="hd" style={{ color: "var(--red-text)" }}>Race weekend dashboard</div>
          <h1>Formula 1, replayed</h1>
          <p>Track map, sector times, gaps and flags for every race, sprint and qualifying session since 2023.</p>
        </div>
      </header>
      <main className="page-main">
        <Suspense fallback={<section className="panel" aria-busy="true"><p className="note">Loading the season…</p></section>}>
          <Season {...props} />
        </Suspense>
      </main>
      <footer className="footer">Data: OpenF1, an unofficial project not affiliated with Formula 1 (CC BY-NC-SA 4.0). Circuit outlines are drawn from OpenF1 car positions. Personal, non-commercial use.</footer>
    </div>
  );
}

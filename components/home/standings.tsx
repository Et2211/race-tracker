import type { HomeData } from "@/lib/home/data";

export function Standings({ standings }: { standings: NonNullable<HomeData["standings"]> }) {
  const leader = standings.drivers[0]?.points ?? 0;
  const teamLeader = standings.teams[0]?.points ?? 0;
  return (
    <section className="panel" aria-labelledby="standings-title">
      <div>
        <h2 id="standings-title">Championship</h2>
        <p className="lede">After the {standings.after}.</p>
      </div>
      <div className="standings">
        <div className="scroll" tabIndex={0} role="region" aria-label="Drivers' championship">
          <table className="timing">
            <caption className="sr-only">Drivers&apos; championship</caption>
            <thead>
              <tr><th scope="col" className="left">P</th><th scope="col" className="left">Driver</th><th scope="col">Points</th><th scope="col">Gap</th></tr>
            </thead>
            <tbody>
              {standings.drivers.map((d) => (
                <tr key={d.driver}>
                  <td className="num left muted">{d.position}</td>
                  <th scope="row">
                    <span className="drv" style={{ minHeight: 36 }}>
                      <span className="bar" style={{ background: d.colour }} />
                      <span className="code" style={{ fontSize: 17 }}>{d.fullName || d.name || d.code}</span>
                      <span className="name num">#{d.driver}</span>
                    </span>
                  </th>
                  <td className="num" style={{ fontWeight: 600 }}>{d.points}</td>
                  <td className="num muted">{d.position === 1 ? "—" : `−${leader - d.points}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="scroll" tabIndex={0} role="region" aria-label="Constructors' championship">
          <table className="timing">
            <caption className="sr-only">Constructors&apos; championship</caption>
            <thead>
              <tr><th scope="col" className="left">P</th><th scope="col" className="left">Team</th><th scope="col">Points</th><th scope="col">Gap</th></tr>
            </thead>
            <tbody>
              {standings.teams.map((t) => (
                <tr key={t.team}>
                  <td className="num left muted">{t.position}</td>
                  <th scope="row">
                    <span className="drv" style={{ minHeight: 36 }}>
                      <span className="bar" style={{ background: t.colour }} />
                      <span style={{ fontWeight: 600 }}>{t.team}</span>
                    </span>
                  </th>
                  <td className="num" style={{ fontWeight: 600 }}>{t.points}</td>
                  <td className="num muted">{t.position === 1 ? "—" : `−${teamLeader - t.points}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

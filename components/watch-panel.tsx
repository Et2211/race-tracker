import type { Snapshot } from "@/lib/dashboard/model";
import type { StaticView } from "@/lib/dashboard/snapshot";
import type { Battle } from "@/lib/timing/battles";

const STREAMS = [
  { name: "F1 TV", href: "https://f1tv.formula1.com/" },
  { name: "NOW", href: "https://www.nowtv.com/watch/home" },
];

function detail(b: Battle): string {
  const gap = `${b.gap.toFixed(1)} s`;
  if (b.kind === "fight") return `${gap} apart, within DRS range`;
  if (b.kind === "catching") return `${gap} back, closing ${(-b.rate!).toFixed(1)} s a lap: within a second in about ${b.lapsToFight} lap${b.lapsToFight === 1 ? "" : "s"}`;
  return `${gap} apart${b.rate !== null && b.rate < -0.05 ? `, closing ${(-b.rate).toFixed(1)} s a lap` : ""}`;
}

/** Who to watch right now, worked out from the gaps between cars at each crossing of the line. */
export function WatchPanel({ view, watch, selected, onSelect }: { view: StaticView; watch: NonNullable<Snapshot["watch"]>; selected: number | null; onSelect: (driver: number) => void }) {
  const who = (n: number) => {
    const d = view.drivers[n];
    return d ? `${d.name} #${n}` : `#${n}`;
  };
  return (
    <section className="panel watch" aria-labelledby="watch-title">
      <div>
        <h2 id="watch-title" className="small">Worth watching</h2>
        <p className="lede">Cars within a second of each other, or catching the car ahead, from the gaps at the line over the last few laps.</p>
      </div>
      {watch.note ? (
        <p className="note">{watch.note}</p>
      ) : watch.battles.length === 0 ? (
        <p className="note">No close fights right now: every car is more than two seconds from the next.</p>
      ) : (
        <ol className="watch-list">
          {watch.battles.map((b) => (
            <li key={`${b.ahead}-${b.behind}`}>
              <button className="watch-row" onClick={() => onSelect(b.behind)} aria-pressed={selected === b.behind}>
                <span className={`watch-kind ${b.kind}`}>{b.kind === "fight" ? "Fight" : b.kind === "catching" ? "Catching" : "Close"}</span>
                <span className="watch-pair">
                  <span className="bar" style={{ background: view.drivers[b.behind]?.colour, height: 14 }} />
                  <strong>{who(b.behind)}</strong> on <span className="bar" style={{ background: view.drivers[b.ahead]?.colour, height: 14 }} />
                  <strong>{who(b.ahead)}</strong> for P{b.position}
                </span>
                <span className="watch-detail">{detail(b)}. Onboard: {view.drivers[b.behind]?.name ?? `#${b.behind}`}.</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="watch-streams">
        {STREAMS.map((s) => (
          <a key={s.name} href={s.href} target="_blank" rel="noopener noreferrer" className="stream-link">
            Open {s.name} ↗
          </a>
        ))}
      </div>
      <p className="note">Streams open in a new window: F1 TV and NOW block being shown inside other sites. Onboard cameras are on F1 TV; a replay here is not synced to their video.</p>
    </section>
  );
}

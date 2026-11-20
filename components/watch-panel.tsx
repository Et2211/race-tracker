import { memo } from "react";
import type { Snapshot } from "@/lib/dashboard/model";
import type { StaticView } from "@/lib/dashboard/snapshot";
import { passingAid, type Battle, type TyreState } from "@/lib/timing/battles";

const STREAMS = [
  { name: "F1 TV", href: "https://f1tv.formula1.com/" },
  { name: "NOW", href: "https://www.nowtv.com/watch/home" },
];

function detail(b: Battle, year: number): string {
  const gap = `${b.gap.toFixed(1)} s`;
  if (b.kind === "fight") return `${gap} apart, within ${passingAid(year)} range`;
  if (b.kind === "catching") return `${gap} back, closing ${(-b.rate!).toFixed(1)} s a lap: within a second in about ${b.lapsToFight} lap${b.lapsToFight === 1 ? "" : "s"}`;
  return `${gap} apart${b.rate !== null && b.rate < -0.05 ? `, closing ${(-b.rate).toFixed(1)} s a lap` : ""}`;
}

const COMPOUND: Record<string, string> = { SOFT: "softs", MEDIUM: "mediums", HARD: "hards", INTERMEDIATE: "inters", WET: "wets" };

function tyres(s: TyreState | null): string {
  if (!s) return "tyres not known";
  const compound = s.compound ? (COMPOUND[s.compound] ?? s.compound.toLowerCase()) : "unknown tyres";
  return s.age === null ? compound : `${compound}, ${s.age} lap${s.age === 1 ? "" : "s"} old`;
}

function strategyNote(b: Battle, name: (n: number) => string): string | null {
  const s = b.strategy;
  if (!s) return null;
  const parts: string[] = [];
  if (s.fresher && s.ageGap) parts.push(`${name(s.fresher === "behind" ? b.behind : b.ahead)} is on tyres ${Math.abs(s.ageGap)} laps fresher`);
  if (s.stopsAhead === 0 && s.stopsBehind > 0) parts.push(`${name(b.ahead)} has not stopped yet`);
  if (s.stopsBehind === 0 && s.stopsAhead > 0) parts.push(`${name(b.behind)} has not stopped yet`);
  return `Not a straight fight: ${parts.join("; ")}.`;
}

/** Who to watch right now, worked out from the gaps between cars at each crossing of the line. */
export const WatchPanel = memo(function WatchPanel({ view, year, watch, selected, onSelect }: { view: StaticView; year: number; watch: NonNullable<Snapshot["watch"]>; selected: number | null; onSelect: (driver: number) => void }) {
  const who = (n: number) => {
    const d = view.drivers[n];
    return d ? `${d.name} #${n}` : `#${n}`;
  };
  return (
    <section className="panel watch" aria-labelledby="watch-title">
      <div>
        <h2 id="watch-title" className="small">Worth watching</h2>
        <p className="lede">Cars within a second of each other, or closing in on the car ahead.</p>
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
                <span className="watch-pair">
                  <span className={`watch-kind ${b.strategy ? "strategy" : b.kind}`}>{b.strategy ? "Strategy" : b.kind === "fight" ? "Fight" : b.kind === "catching" ? "Catching" : "Close"}</span>
                  <span className="bar" style={{ background: view.drivers[b.behind]?.colour, height: 14 }} />
                  <strong>{who(b.behind)}</strong> on <span className="bar" style={{ background: view.drivers[b.ahead]?.colour, height: 14 }} />
                  <strong>{who(b.ahead)}</strong> for P{b.position}
                </span>
                <span className="watch-detail">{detail(b, year)}. Onboard: {view.drivers[b.behind]?.name ?? `#${b.behind}`}.</span>
                <span className="watch-detail">
                  Tyres: {view.drivers[b.behind]?.name ?? `#${b.behind}`} {tyres(b.tyres.behind)} · {view.drivers[b.ahead]?.name ?? `#${b.ahead}`} {tyres(b.tyres.ahead)}
                </span>
                {b.strategy && <span className="watch-detail watch-strategy">{strategyNote(b, (n) => view.drivers[n]?.name ?? `#${n}`)}</span>}
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
      <p className="note">Streams open in a new tab. Onboard cameras are on F1 TV.</p>
    </section>
  );
});

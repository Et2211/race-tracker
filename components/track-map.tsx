import type { CarDot, Snapshot, TrackMapModel } from "@/lib/dashboard/model";
import type { StaticView } from "@/lib/dashboard/snapshot";

const SECTOR_COLOURS = ["var(--s1)", "var(--s2)", "var(--s3)"];

type Props = { view: StaticView; map: TrackMapModel; circuit: string; snapshot: Snapshot; cars: CarDot[]; selected: number | null; onSelect: (driver: number) => void };

export function TrackMap({ view, map, circuit, snapshot, cars: dots, selected, onSelect }: Props) {
  const stopped = new Set(snapshot.flags.flatMap((f) => f.stopped.filter((c) => c.role === "first" || c.role === "stopped").map((c) => c.driver)));
  const placed = snapshot.flags.filter((f) => f.placement.known);
  // Draw the selected car last so it sits on top.
  const cars = [...dots].sort((a, b) => Number(a.driver === selected) - Number(b.driver === selected));
  const summary = [
    `Map of the ${circuit} circuit with three timing sectors and ${cars.length} cars.`,
    snapshot.safetyCar ? `${snapshot.safetyCar.kind === "VSC" ? "Virtual safety car" : "Safety car"}: whole track under caution.` : "",
    ...snapshot.flags.map((f) => `${f.flag === "DOUBLE YELLOW" ? "Double yellow" : "Yellow"} flag in marshal sector ${f.sector}${f.placement.known ? ", highlighted" : ", position not known"}.`),
  ].join(" ");

  return (
    <svg viewBox={`0 0 ${map.width} ${map.height}`} role="img" aria-label={summary} className="map">
      {placed.map((f) => f.placement.known && (
        <path key={`glow-${f.sector}`} d={f.placement.path} fill="none" stroke="var(--yellow)" strokeOpacity={0.22} strokeWidth={40} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {map.sectorPaths.map((d, i) => <path key={`o${i}`} d={d} stroke="var(--track)" strokeWidth={22} />)}
        {map.sectorPaths.map((d, i) => <path key={`f${i}`} d={d} stroke="var(--track-fill)" strokeWidth={17} />)}
        {snapshot.safetyCar && map.sectorPaths.map((d, i) => <path key={`sc${i}`} d={d} stroke="var(--yellow)" strokeOpacity={0.5} strokeWidth={17} />)}
        {placed.map((f) => f.placement.known && (
          <path key={`hi-${f.sector}`} d={f.placement.path} stroke="var(--yellow)" strokeOpacity={0.9} strokeWidth={17} strokeDasharray="10 5" strokeLinecap="butt" />
        ))}
        {map.sectorPaths.map((d, i) => <path key={`c${i}`} d={d} stroke={SECTOR_COLOURS[i]} strokeWidth={2.5} />)}
      </g>
      <g stroke="var(--dot)">
        {map.ticks.map((t, i) => <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} strokeWidth={t.start ? 4 : 2} />)}
      </g>
      <g fontFamily="var(--cond)" fontWeight={700} textAnchor="middle">
        {map.labels.map((l) => (
          <text key={l.text} x={l.x} y={l.y} fontSize={l.sector === 0 ? 12 : 18} fill={l.sector === 0 ? "var(--muted)" : SECTOR_COLOURS[l.sector - 1]}>{l.text}</text>
        ))}
      </g>
      {placed.map((f) => f.placement.known && (
        <g key={`flag-${f.sector}`} transform={`translate(${f.placement.flagX - 12} ${f.placement.flagY - 18})`}>
          <line x1={0} y1={0} x2={0} y2={f.flag === "DOUBLE YELLOW" ? 38 : 30} stroke="var(--dot)" strokeWidth={2.5} strokeLinecap="round" />
          <polygon points="0,0 24,8 0,16" fill="var(--yellow)" />
          {f.flag === "DOUBLE YELLOW" && <polygon points="0,18 24,26 0,34" fill="var(--yellow)" />}
          <text x={30} y={13} fill="var(--yellow)" fontFamily="var(--sans)" fontWeight={700} fontSize={12}>MS {f.sector}</text>
        </g>
      ))}
      {snapshot.flags.flatMap((f) => f.stopped.filter((c) => c.x !== null && c.y !== null).map((c) => (
        <circle key={`stop-${f.sector}-${c.driver}`} cx={c.x!} cy={c.y!} r={20} fill="none" stroke="var(--yellow)" strokeWidth={2} strokeDasharray="4 3" />
      )))}
      {cars.map((car) => {
        const d = view.drivers[car.driver];
        const isSel = car.driver === selected;
        return (
          <g key={car.driver} data-driver={car.driver} onClick={() => onSelect(car.driver)} style={{ cursor: "pointer" }}>
            {isSel && <circle cx={car.x} cy={car.y} r={15} fill="none" stroke="var(--red)" strokeWidth={3} />}
            <circle cx={car.x} cy={car.y} r={9.5} fill="var(--dot)" stroke={stopped.has(car.driver) ? "var(--yellow)" : d?.colour ?? "var(--bg)"} strokeWidth={stopped.has(car.driver) ? 4 : 2.5} />
            <text x={car.x} y={car.y + 3.5} textAnchor="middle" fontFamily="var(--mono)" fontWeight={600} fontSize={9.5} fill="#0e1014">{car.driver}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function MapLegend() {
  return (
    <div className="legend">
      <span><i className="key-line" style={{ background: "var(--s1)" }} />Sector 1</span>
      <span><i className="key-line" style={{ background: "var(--s2)" }} />Sector 2</span>
      <span><i className="key-line" style={{ background: "var(--s3)" }} />Sector 3</span>
      <span><i className="key-line" style={{ height: 8, background: "repeating-linear-gradient(90deg, var(--yellow) 0 5px, transparent 5px 8px)" }} />Flagged sector</span>
      <span><i className="key-dot" style={{ background: "var(--dot)", border: "3px solid var(--yellow)" }} />Stopped car</span>
      <span><i className="key-dot" style={{ width: 14, height: 14, border: "2px solid var(--red)" }} />Selected driver</span>
      <span><i className="key-dot" style={{ background: "var(--dot)", border: "2px solid var(--muted)" }} />Team colour</span>
    </div>
  );
}

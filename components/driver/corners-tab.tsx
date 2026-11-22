import type { StaticView } from "@/lib/dashboard/snapshot";
import type { CornerRow, CornerSet } from "@/lib/driver/corners";
import type { LapOption } from "@/lib/driver/lap-compare";
import { LapPickers, type TraceState } from "./lap-compare-tab";

const m = (v: number | null) => (v === null ? "–" : v < 5 ? "at the turn" : `${Math.round(v)} m`);
const kmh = (v: number | null) => (v === null ? "–" : `${v}`);

export function CornersTab({
  options,
  driver,
  a,
  b,
  onA,
  onB,
  traces,
  set,
  year,
  rows,
  view,
}: {
  options: LapOption[];
  driver: number;
  a: LapOption | null;
  b: LapOption | null;
  onA: (o: LapOption) => void;
  onB: (o: LapOption) => void;
  traces: { a: TraceState | null; b: TraceState | null };
  set: CornerSet | null;
  /** The year of the MultiViewer file the turns come from. */
  year: number | null;
  rows: CornerRow[] | null;
  view: StaticView;
}) {
  const code = (n: number) => view.drivers[n]?.code ?? `#${n}`;
  if (!a) return <p className="note">No completed laps yet.</p>;
  const nameA = `${code(a.driver)} L${a.lap}`;
  const nameB = b ? `${code(b.driver)} L${b.lap}` : "";
  const problem = (s: TraceState | null, name: string) => (s === "loading" ? `Car data for ${name} is still downloading.` : s && "error" in s ? `${name}: ${s.error}` : null);
  const problems = [problem(traces.a, nameA), b ? problem(traces.b, nameB) : null].filter(Boolean) as string[];

  const total = rows && rows.every((r) => r.gain !== null) ? rows.reduce((sum, r) => sum + r.gain!, 0) : null;
  const lapGain = b ? b.time - a.time : null;
  const ranked = rows ? [...rows].filter((r) => r.gain !== null).sort((x, y) => y.gain! - x.gain!) : [];
  const best = ranked.filter((r) => r.gain! > 0.02).slice(0, 3);
  const worst = ranked.filter((r) => r.gain! < -0.02).slice(-3).reverse();
  const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} s`;

  return (
    <div className="driver-tab">
      <LapPickers options={options} driver={driver} a={a} b={b} onA={onA} onB={onB} view={view} />
      {problems.map((p) => <p key={p} className="note" role="status">{p}</p>)}
      {set && rows && b && (
        <>
          {total !== null && lapGain !== null && (
            <div className="inset">
              <p style={{ margin: 0 }}>
                Through the corners {nameA} was {total >= 0 ? "quicker" : "slower"} by <strong>{Math.abs(total).toFixed(2)} s</strong>
                {Math.abs(lapGain - total) >= 0.01 ? (
                  <>, and {lapGain - total >= 0 ? "gained" : "lost"} {Math.abs(lapGain - total).toFixed(2)} s on the straights between them</>
                ) : null}
                , {lapGain >= 0 ? `${Math.abs(lapGain).toFixed(3)} s quicker` : `${Math.abs(lapGain).toFixed(3)} s slower`} over the lap.
              </p>
              {(best.length > 0 || worst.length > 0) && (
                <p className="note" style={{ marginTop: 6 }}>
                  {best.length > 0 && <>Most gained by {code(a.driver)}: {best.map((r) => `${r.corner.label} (${r.gain!.toFixed(2)} s)`).join(", ")}. </>}
                  {worst.length > 0 && <>Most gained by {code(b.driver)}: {worst.map((r) => `${r.corner.label} (${(-r.gain!).toFixed(2)} s)`).join(", ")}.</>}
                </p>
              )}
            </div>
          )}
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Corner by corner">
            <table className="timing corners">
              <caption className="sr-only">Corner by corner, {nameA} against {nameB}</caption>
              <thead>
                <tr>
                  <th scope="col" className="left" rowSpan={2}>Corner</th>
                  <th scope="colgroup" colSpan={2}>Braking before</th>
                  <th scope="colgroup" colSpan={2}>Slowest, km/h</th>
                  <th scope="colgroup" colSpan={2}>Exit, km/h</th>
                  <th scope="col" rowSpan={2}>{code(a.driver)} gained</th>
                </tr>
                <tr>
                  {[0, 1, 2].flatMap((i) => [<th key={`a${i}`} scope="col">{code(a.driver)}</th>, <th key={`b${i}`} scope="col">{code(b.driver)}</th>])}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.corner.label}>
                    <th scope="row" className="left">{r.corner.label}</th>
                    <td className="num">{m(r.a.brakeBefore)}</td>
                    <td className="num">{m(r.b?.brakeBefore ?? null)}</td>
                    <td className="num">{kmh(r.a.slowest)}</td>
                    <td className="num">{kmh(r.b?.slowest ?? null)}</td>
                    <td className="num">{kmh(r.a.exit)}</td>
                    <td className="num">{kmh(r.b?.exit ?? null)}</td>
                    <td className={`num ${r.gain !== null && Math.abs(r.gain) >= 0.05 ? "strong" : ""}`}>{r.gain === null ? "–" : signed(r.gain)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            {set.source === "multiviewer"
              ? `Turns numbered as on the official circuit map (MultiViewer's ${year ?? ""} circuit file). `
              : `This circuit has no turn map to use, so corners are found from ${nameA}'s speed: each place the car slowed by at least 25 km/h. They are numbered here (C1, C2…), not official turn numbers. `}
            Each corner covers up to 250 m before it and 150 m after, stopping halfway to the next. Braking before: how far before the corner the brake went on; – means no brake (a lift or flat out). Exit: speed 100 m after the slowest point, – when already braking for the next corner. Gained: time through the corner&apos;s stretch, + when {code(a.driver)} was quicker. With car data about four times a second, braking points and speeds are good to a few metres and km/h, and times to about a tenth.
          </p>
        </>
      )}
      {!b && <p className="note">Pick a lap to compare with.</p>}
    </div>
  );
}

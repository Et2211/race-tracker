import { readFileSync } from "node:fs";
import path from "node:path";
import type { CarDataRow, LocationRow, RaceControl } from "@/lib/openf1/types";
import { encodeChunk, TelemetryIndex } from "@/lib/session/telemetry";

/** Read a recorded OpenF1 response from fixtures/openf1/<slug>/<name>.json. */
export const fixture = <T,>(slug: string, name: string): T =>
  JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "openf1", slug, `${name}.json`), "utf8")) as T;

export const raceControl = (slug: string) => fixture<RaceControl[]>(slug, "race_control").sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

/** Telemetry index built the same way the browser builds it, through the compact encoding. */
export function telemetryFor(slug: string, windows: { name: string; from: string; to: string }[]): TelemetryIndex {
  const index = new TelemetryIndex();
  windows.forEach((w, i) => {
    const chunk = encodeChunk(i, Date.parse(w.from), Date.parse(w.to), fixture<LocationRow[]>(slug, `location.${w.name}`), fixture<CarDataRow[]>(slug, `car_data.${w.name}`));
    index.add(JSON.parse(JSON.stringify(chunk)));
  });
  return index;
}

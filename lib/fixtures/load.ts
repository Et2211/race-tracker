import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(process.cwd(), "fixtures");

/** Read one recorded fixture file, e.g. `readFixture("openf1/2026-madrid-race/laps.json")`. */
export async function readFixture<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(ROOT, relativePath), "utf8")) as T;
}

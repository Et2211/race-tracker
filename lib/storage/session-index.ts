import "server-only";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { diskRoot, getStore, readJson, writeJson } from "./store";
import { supabase, supabaseConfigured } from "./supabase";

/**
 * Which sessions are stored and how much space they use: the Supabase table `stored_sessions`,
 * or a manifest file next to the disk store. Drives the storage cap and the picker's
 * "downloaded" markers.
 */

export class StorageFullError extends Error {}

export type SessionInfo = { sessionKey: number; year: number; meetingName: string; sessionName: string; circuitKey: number; windows: number };

/** New downloads are refused above this; Supabase's free plan includes 1 GB of storage. */
const CAP_BYTES = Number(process.env.STORE_CAP_MB ?? 900) * 1024 * 1024;
/** Typical stored size: ~0.45 MB of metadata plus ~0.65 MB per 15-minute window. */
export const estimateBytes = (windows: number) => 500_000 + windows * 700_000;
const mb = (n: number) => Math.round(n / 1024 / 1024);

const full = (used: number) =>
  new StorageFullError(`Session storage is nearly full (${mb(used)} MB of ${mb(CAP_BYTES)} MB used), so new sessions cannot be downloaded. Sessions already downloaded still open.`);

interface SessionIndex {
  /** Register a session before downloading it; throws StorageFullError over the cap. */
  reserve(info: SessionInfo): Promise<void>;
  /** The real window count, once the session's metadata is assembled. */
  setWindows(sessionKey: number, windows: number): Promise<void>;
  /** Count bytes written for a session, and whether they completed a telemetry window. */
  added(sessionKey: number, bytes: number, window: boolean): Promise<void>;
  /** Sessions with metadata and every telemetry window stored. */
  complete(): Promise<Set<number>>;
  /** Bytes stored for sessions, the cap, and how many sessions are complete. */
  usage(): Promise<StorageUsage>;
  /** Both of the above from one read. */
  overview(): Promise<{ complete: Set<number>; usage: StorageUsage }>;
  /** Stored sessions at a circuit, newest first (for a live session's outline). */
  atCircuit(circuitKey: number): Promise<number[]>;
  /** Set a session's counts from what is actually stored (counters can drift if a run is cut off). */
  reconcile(sessionKey: number, counts: { windows: number; windowsStored: number; bytes: number }): Promise<void>;
}

export type StorageUsage = { bytes: number; capBytes: number; sessions: number };

class SupabaseIndex implements SessionIndex {
  async reserve(info: SessionInfo) {
    const db = supabase();
    const { data: existing, error: e1 } = await db.from("stored_sessions").select("session_key").eq("session_key", info.sessionKey).maybeSingle();
    if (e1) throw e1;
    if (existing) return;
    const { data: rows, error: e2 } = await db.from("stored_sessions").select("bytes, windows, windows_stored");
    if (e2) throw e2;
    // Sessions still downloading count at their estimated final size.
    const used = rows.reduce((sum, r) => sum + Math.max(Number(r.bytes), r.windows_stored < r.windows ? estimateBytes(r.windows) : 0), 0);
    if (used + estimateBytes(info.windows) > CAP_BYTES) throw full(used);
    const { error } = await db.from("stored_sessions").upsert(
      { session_key: info.sessionKey, year: info.year, meeting_name: info.meetingName, session_name: info.sessionName, circuit_key: info.circuitKey, windows: info.windows },
      { onConflict: "session_key", ignoreDuplicates: true },
    );
    if (error) throw error;
  }
  async setWindows(sessionKey: number, windows: number) {
    const { error } = await supabase().from("stored_sessions").update({ windows, updated_at: new Date().toISOString() }).eq("session_key", sessionKey);
    if (error) throw error;
  }
  async added(sessionKey: number, bytes: number, window: boolean) {
    const { error } = await supabase().rpc("add_stored_bytes", { p_session_key: sessionKey, p_bytes: bytes, p_window: window });
    if (error) throw error;
  }
  async complete() {
    const { data, error } = await supabase().from("stored_sessions").select("session_key, windows, windows_stored");
    if (error) throw error;
    return new Set(data.filter((r) => r.windows_stored >= r.windows).map((r) => r.session_key as number));
  }
  async usage() {
    return (await this.overview()).usage;
  }
  async overview() {
    const { data, error } = await supabase().from("stored_sessions").select("session_key, bytes, windows, windows_stored");
    if (error) throw error;
    const complete = new Set(data.filter((r) => r.windows_stored >= r.windows).map((r) => r.session_key as number));
    return { complete, usage: { bytes: data.reduce((s, r) => s + Number(r.bytes), 0), capBytes: CAP_BYTES, sessions: complete.size } };
  }
  async reconcile(sessionKey: number, counts: { windows: number; windowsStored: number; bytes: number }) {
    const { error } = await supabase()
      .from("stored_sessions")
      .update({ windows: counts.windows, windows_stored: counts.windowsStored, bytes: counts.bytes, updated_at: new Date().toISOString() })
      .eq("session_key", sessionKey);
    if (error) throw error;
  }
  async atCircuit(circuitKey: number) {
    const { data, error } = await supabase().from("stored_sessions").select("session_key").eq("circuit_key", circuitKey).order("year", { ascending: false }).order("session_key", { ascending: false }).limit(6);
    if (error) throw error;
    return data.map((r) => r.session_key as number);
  }
}

type Manifest = { sessions: Record<string, { windows: number; windowsStored: number; bytes: number }> };

/** Development store on disk. Sessions downloaded before the manifest existed are counted on first use. */
class DiskIndex implements SessionIndex {
  private readonly key = "manifest.json";
  private async load(): Promise<Manifest> {
    const manifest = (await readJson<Manifest & { bytes?: number }>(this.key)) ?? { sessions: {} };
    const dir = path.join(diskRoot(), "sessions");
    let changed = false;
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (manifest.sessions[name] && manifest.sessions[name].windows > 0) continue;
      const meta = await readJson<{ windows: unknown[] }>(`sessions/${name}/meta.json`);
      if (!meta) continue;
      const files = await readdir(path.join(dir, name));
      const chunks = files.filter((f) => /^chunk-\d+\.json\.gz$/.test(f)).length;
      manifest.sessions[name] = { windows: meta.windows.length, windowsStored: chunks, bytes: estimateBytes(chunks) };
      changed = true;
    }
    if (changed) await writeJson(this.key, { sessions: manifest.sessions });
    return { sessions: manifest.sessions };
  }
  private used(m: Manifest) {
    return Object.values(m.sessions).reduce((sum, s) => sum + Math.max(s.bytes, s.windowsStored < s.windows ? estimateBytes(s.windows) : 0), 0);
  }
  async reserve(info: SessionInfo) {
    const m = await this.load();
    if (m.sessions[info.sessionKey]) return;
    const used = this.used(m);
    if (used + estimateBytes(info.windows) > CAP_BYTES) throw full(used);
    m.sessions[info.sessionKey] = { windows: info.windows, windowsStored: 0, bytes: 0 };
    await writeJson(this.key, m);
  }
  async setWindows(sessionKey: number, windows: number) {
    const m = await this.load();
    if (m.sessions[sessionKey]) m.sessions[sessionKey].windows = windows;
    await writeJson(this.key, m);
  }
  async added(sessionKey: number, bytes: number, window: boolean) {
    const m = await this.load();
    const s = (m.sessions[sessionKey] ??= { windows: 0, windowsStored: 0, bytes: 0 });
    s.bytes += bytes;
    if (window) s.windowsStored++;
    await writeJson(this.key, m);
  }
  async complete() {
    const m = await this.load();
    return new Set(Object.entries(m.sessions).filter(([, s]) => s.windows > 0 && s.windowsStored >= s.windows).map(([k]) => Number(k)));
  }
  async overview() {
    return { complete: await this.complete(), usage: await this.usage() };
  }
  async usage() {
    const m = await this.load();
    const all = Object.values(m.sessions);
    return { bytes: all.reduce((s, x) => s + x.bytes, 0), capBytes: CAP_BYTES, sessions: all.filter((s) => s.windows > 0 && s.windowsStored >= s.windows).length };
  }
  async reconcile(sessionKey: number, counts: { windows: number; windowsStored: number; bytes: number }) {
    const m = await this.load();
    m.sessions[sessionKey] = { windows: counts.windows, windowsStored: counts.windowsStored, bytes: counts.bytes };
    await writeJson(this.key, m);
  }
  async atCircuit(circuitKey: number) {
    const m = await this.load();
    const found: { key: number; year: number }[] = [];
    for (const key of Object.keys(m.sessions)) {
      const meta = await readJson<{ session: { circuit_key: number; year: number } }>(`sessions/${key}/meta.json`);
      if (meta?.session.circuit_key === circuitKey) found.push({ key: Number(key), year: meta.session.year });
    }
    return found.sort((a, b) => b.year - a.year || b.key - a.key).map((f) => f.key);
  }
}

let index: SessionIndex | null = null;
export function sessionIndex(): SessionIndex {
  index ??= supabaseConfigured() && getStore().kind === "supabase" ? new SupabaseIndex() : new DiskIndex();
  return index;
}

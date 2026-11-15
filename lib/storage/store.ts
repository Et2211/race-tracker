import "server-only";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { BUCKET, supabase, supabaseConfigured } from "./supabase";

/**
 * Permanent cache for downloaded session data. Values are gzipped JSON.
 * - Supabase Storage (private "sessions" bucket) when SUPABASE_URL and SUPABASE_SECRET_KEY are set.
 * - Otherwise a local directory (STORE_DIR, default .cache/store), used in development.
 */
export interface Store {
  readonly kind: "supabase" | "disk";
  /** Gzipped bytes, or null when the key does not exist. */
  getRaw(key: string): Promise<Buffer | null>;
  putRaw(key: string, gz: Buffer): Promise<void>;
  /** Files directly under a folder (e.g. "sessions/11369"), names without the .gz suffix, with sizes. */
  list(folder: string): Promise<{ name: string; bytes: number }[]>;
}

class DiskStore implements Store {
  readonly kind = "disk";
  constructor(readonly root: string) {}
  private file(key: string) {
    const target = path.resolve(this.root, `${key}.gz`);
    if (!target.startsWith(path.resolve(this.root) + path.sep)) throw new Error(`Bad store key: ${key}`);
    return target;
  }
  async getRaw(key: string) {
    try {
      return await readFile(this.file(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async putRaw(key: string, gz: Buffer) {
    const target = this.file(key);
    await mkdir(path.dirname(target), { recursive: true });
    // Write then rename so a crash never leaves a half-written file under the real name.
    await writeFile(`${target}.tmp`, gz);
    await rename(`${target}.tmp`, target);
  }
  async list(folder: string) {
    const dir = path.resolve(this.root, folder);
    const names = await readdir(dir).catch(() => [] as string[]);
    const out: { name: string; bytes: number }[] = [];
    for (const n of names) if (n.endsWith(".gz")) out.push({ name: n.slice(0, -3), bytes: (await stat(path.join(dir, n))).size });
    return out;
  }
}

class SupabaseStore implements Store {
  readonly kind = "supabase";
  async getRaw(key: string) {
    const { data, error } = await supabase().storage.from(BUCKET).download(`${key}.gz`);
    if (error) {
      const status = (error as { status?: number }).status;
      if (status === 400 || status === 404) return null; // the Storage API reports a missing object as 400 or 404
      throw error;
    }
    return Buffer.from(await data.arrayBuffer());
  }
  async putRaw(key: string, gz: Buffer) {
    const { error } = await supabase().storage.from(BUCKET).upload(`${key}.gz`, gz, { contentType: "application/gzip", upsert: true });
    if (error) throw error;
  }
  async list(folder: string) {
    const { data, error } = await supabase().storage.from(BUCKET).list(folder, { limit: 1000 });
    if (error) throw error;
    return data.filter((f) => f.name.endsWith(".gz")).map((f) => ({ name: f.name.slice(0, -3), bytes: Number((f.metadata as { size?: number } | null)?.size ?? 0) }));
  }
}

let store: Store | null = null;

export function getStore(): Store {
  store ??= supabaseConfigured() ? new SupabaseStore() : new DiskStore(diskRoot());
  return store;
}

export const diskRoot = () => process.env.STORE_DIR ?? path.join(process.cwd(), ".cache", "store");

export async function readJson<T>(key: string): Promise<T | null> {
  const raw = await getStore().getRaw(key);
  return raw ? (JSON.parse(gunzipSync(raw).toString("utf8")) as T) : null;
}

/** Store a value; returns its stored (gzipped) size in bytes. */
export async function writeJson(key: string, value: unknown): Promise<number> {
  const gz = gzipSync(JSON.stringify(value));
  await getStore().putRaw(key, gz);
  return gz.length;
}

import "server-only";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { del, get, put } from "@vercel/blob";

/**
 * Permanent cache for ingested session data. Values are gzipped JSON.
 * - Vercel Blob (private) when BLOB_READ_WRITE_TOKEN is set; this backend has not yet been run
 *   against a real store.
 * - Otherwise a local directory (STORE_DIR, default .cache/store), used in development.
 */
export interface Store {
  readonly kind: "blob" | "disk";
  /** Gzipped bytes, or null when the key does not exist. */
  getRaw(key: string): Promise<Buffer | null>;
  putRaw(key: string, gz: Buffer): Promise<void>;
  remove(key: string): Promise<void>;
}

class DiskStore implements Store {
  readonly kind = "disk";
  constructor(private readonly root: string) {}
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
  async remove(key: string) {
    await rm(this.file(key), { force: true });
  }
}

class BlobStore implements Store {
  readonly kind = "blob";
  async getRaw(key: string) {
    const result = await get(`${key}.gz`, { access: "private" });
    if (!result || result.statusCode !== 200) return null;
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }
  async putRaw(key: string, gz: Buffer) {
    // One put is one Advanced Operation; Hobby includes 2,000 a month.
    await put(`${key}.gz`, gz, { access: "private", allowOverwrite: true, contentType: "application/gzip", addRandomSuffix: false });
  }
  async remove(key: string) {
    await del(`${key}.gz`);
  }
}

let store: Store | null = null;

export function getStore(): Store {
  store ??= process.env.BLOB_READ_WRITE_TOKEN ? new BlobStore() : new DiskStore(process.env.STORE_DIR ?? path.join(process.cwd(), ".cache", "store"));
  return store;
}

export async function readJson<T>(key: string): Promise<T | null> {
  const raw = await getStore().getRaw(key);
  return raw ? (JSON.parse(gunzipSync(raw).toString("utf8")) as T) : null;
}

export async function writeJson(key: string, value: unknown): Promise<number> {
  const gz = gzipSync(JSON.stringify(value));
  await getStore().putRaw(key, gz);
  return gz.length;
}

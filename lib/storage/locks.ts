import "server-only";
import { noLocks, type LockBackend } from "./download-lock";
import { supabase, supabaseConfigured } from "./supabase";

/** Download locks in Supabase (`download_locks`), or none on the single-process disk store. */
export function downloadLocks(): LockBackend {
  if (!supabaseConfigured()) return noLocks;
  return {
    async claim(key, holder, ttlSeconds) {
      const { data, error } = await supabase().rpc("claim_download", { p_key: key, p_holder: holder, p_ttl_seconds: ttlSeconds });
      if (error) throw error;
      return data === true;
    },
    async release(key, holder) {
      const { error } = await supabase().rpc("release_download", { p_key: key, p_holder: holder });
      if (error) throw error;
    },
    async running(key) {
      const { data, error } = await supabase().rpc("download_running", { p_key: key });
      if (error) throw error;
      return data === true;
    },
  };
}

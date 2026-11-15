import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** The private bucket holding gzipped session files (see supabase/migrations). */
export const BUCKET = "sessions";

/** Supabase is used when both are set; the secret key never leaves the server. */
export const supabaseConfigured = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);

let client: SupabaseClient | null = null;

/** Server-side client with the project's secret key, which bypasses row-level security. */
export function supabase(): SupabaseClient {
  if (!supabaseConfigured()) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are not set");
  client ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically by the
// Edge Runtime for every function — no need to set them as secrets.
export function supabaseAdmin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, {
    db: { schema: "sprintanalise" },
    auth: { persistSession: false },
  });
}

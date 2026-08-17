import { corsHeaders, json } from "../_shared/cors.ts";
import { loadRedmineConfig } from "../_shared/redmine.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { discoverAndUpsertPeople } from "../_shared/roster.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const cfg = loadRedmineConfig();
    const db = supabaseAdmin();
    const people = await discoverAndUpsertPeople(db, cfg);
    return json({ ok: true, people });
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});

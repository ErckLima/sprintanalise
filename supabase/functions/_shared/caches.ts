import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { fetchIssueStatuses, type RedmineConfig, type RedmineIssue, type RedmineStatus } from "./redmine.ts";

// is_closed always comes from here, never inferred from a status name — this
// Redmine instance has closed statuses named "Resolvida", "Cancelada",
// "Fechada", "Inválida", etc.
export async function refreshIssueStatuses(
  db: SupabaseClient,
  cfg: RedmineConfig,
): Promise<Map<number, RedmineStatus>> {
  const statuses = await fetchIssueStatuses(cfg);
  if (statuses.length > 0) {
    const now = new Date().toISOString();
    await db.from("issue_statuses").upsert(
      statuses.map((s) => ({ id: s.id, name: s.name, is_closed: s.is_closed, updated_at: now })),
      { onConflict: "id" },
    );
  }
  return new Map(statuses.map((s) => [s.id, s]));
}

export async function learnCustomFieldDefs(db: SupabaseClient, issues: RedmineIssue[]): Promise<void> {
  const defs = new Map<number, string>();
  for (const issue of issues) {
    for (const cf of issue.custom_fields ?? []) defs.set(cf.id, cf.name);
  }
  if (defs.size === 0) return;
  const now = new Date().toISOString();
  await db.from("custom_field_defs").upsert(
    Array.from(defs, ([id, name]) => ({ id, name, updated_at: now })),
    { onConflict: "id" },
  );
}

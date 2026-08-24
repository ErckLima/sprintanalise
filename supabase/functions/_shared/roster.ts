import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { fetchSprintIssues, type RedmineConfig } from "./redmine.ts";

// Roster is always discovered from Redmine (unique assigned_to across the
// sprint filter, no assigned_to_id) — never a hardcoded list. Existing people
// are never deactivated automatically, only upserted/renamed.
export async function discoverAndUpsertPeople(
  db: SupabaseClient,
  cfg: RedmineConfig,
  currentWeekKey: number,
): Promise<any[]> {
  const issues = await fetchSprintIssues(cfg, currentWeekKey);
  const peopleFromRedmine = new Map<number, string>();
  for (const issue of issues) {
    if (issue.assigned_to) peopleFromRedmine.set(issue.assigned_to.id, issue.assigned_to.name);
  }

  const { data: existingPeople, error: existingErr } = await db.from("people").select("*");
  if (existingErr) throw existingErr;
  const existingByRedmineId = new Map((existingPeople ?? []).map((p: any) => [p.redmine_user_id, p]));
  let nextOrder = (existingPeople ?? []).reduce((max: number, p: any) => Math.max(max, p.display_order), -1) + 1;

  const newRows: any[] = [];
  for (const [id, name] of peopleFromRedmine) {
    const existing = existingByRedmineId.get(id);
    if (existing) {
      if (existing.display_name !== name) {
        const { error } = await db.from("people").update({ display_name: name }).eq("id", existing.id);
        if (error) throw error;
      }
    } else {
      newRows.push({ redmine_user_id: id, display_name: name, active: true, display_order: nextOrder++ });
    }
  }
  if (newRows.length > 0) {
    const { error: insErr } = await db.from("people").insert(newRows);
    if (insErr) throw insErr;
  }

  const { data: roster, error: rosterErr } = await db.from("people").select("*").order("display_order");
  if (rosterErr) throw rosterErr;
  return roster ?? [];
}

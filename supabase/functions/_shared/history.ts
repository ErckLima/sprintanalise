import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Returns, per issue_id, whether it already existed in issue_history *before*
// this call — that's the carryover signal when called at baseline capture time.
export async function touchIssueHistory(
  db: SupabaseClient,
  weekId: number,
  issueIds: number[],
  isBaseline: boolean,
): Promise<Map<number, boolean>> {
  const alreadyKnown = new Map<number, boolean>();
  if (issueIds.length === 0) return alreadyKnown;

  const { data: existing, error } = await db
    .from("issue_history")
    .select("issue_id, times_seen_as_baseline")
    .in("issue_id", issueIds);
  if (error) throw error;

  const existingMap = new Map((existing ?? []).map((h: any) => [h.issue_id, h.times_seen_as_baseline as number]));
  const now = new Date().toISOString();

  const newIds = issueIds.filter((id) => !existingMap.has(id));
  const oldIds = issueIds.filter((id) => existingMap.has(id));

  if (newIds.length > 0) {
    const { error: insErr } = await db.from("issue_history").insert(
      newIds.map((id) => ({
        issue_id: id,
        first_seen_week_id: weekId,
        first_seen_at: now,
        last_seen_week_id: weekId,
        last_seen_at: now,
        times_seen_as_baseline: isBaseline ? 1 : 0,
      })),
    );
    if (insErr) throw insErr;
  }

  if (oldIds.length > 0) {
    if (isBaseline) {
      await Promise.all(
        oldIds.map((id) =>
          db.from("issue_history").update({
            last_seen_week_id: weekId,
            last_seen_at: now,
            times_seen_as_baseline: (existingMap.get(id) ?? 0) + 1,
          }).eq("issue_id", id)
        ),
      );
    } else {
      const { error: updErr } = await db
        .from("issue_history")
        .update({ last_seen_week_id: weekId, last_seen_at: now })
        .in("issue_id", oldIds);
      if (updErr) throw updErr;
    }
  }

  for (const id of issueIds) alreadyKnown.set(id, existingMap.has(id));
  return alreadyKnown;
}

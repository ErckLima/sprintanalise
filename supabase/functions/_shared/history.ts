import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Returns, per issue_id, whatever last_seen_week_id was *before* this call
// (null if the issue has no history row yet). Callers doing baseline capture
// use this to decide "transbordo": an issue only counts as carried over if
// its last sighting was specifically the week being closed right now, not
// merely "seen at some point in the past" -- an issue seen in week 1, absent
// in week 2, and back in week 3 is not transbordo into week 3.
export async function touchIssueHistory(
  db: SupabaseClient,
  weekId: number,
  issueIds: number[],
  isBaseline: boolean,
): Promise<Map<number, number | null>> {
  const previousLastSeenWeek = new Map<number, number | null>();
  if (issueIds.length === 0) return previousLastSeenWeek;

  const { data: existing, error } = await db
    .from("issue_history")
    .select("issue_id, times_seen_as_baseline, last_seen_week_id")
    .in("issue_id", issueIds);
  if (error) throw error;

  const existingMap = new Map((existing ?? []).map((h: any) => [h.issue_id, h]));
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
            times_seen_as_baseline: (existingMap.get(id)?.times_seen_as_baseline ?? 0) + 1,
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

  for (const id of issueIds) {
    previousLastSeenWeek.set(id, existingMap.get(id)?.last_seen_week_id ?? null);
  }
  return previousLastSeenWeek;
}

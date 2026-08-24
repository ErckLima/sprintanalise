import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Redmine's sprint custom field holds a week label like "26-08 S4" (2-digit
// year, 2-digit month, space, S + week-of-month, where week-of-month is
// normally a fixed 7-day block: day 1-7 = S1, 8-14 = S2, 15-21 = S3,
// 22-28 = S4, 29+ = S5). S5 is often skipped by convention (rolled into next
// month's S1 instead), so the "current week" is a deliberate choice by the
// leader when starting a week, not something purely computed from today's
// date — computeWeekLabel is only the *default suggestion* offered for that
// choice, never assumed to be correct.
export function computeWeekLabel(date: Date): string {
  const yy = String(date.getFullYear() % 100).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const weekNum = Math.ceil(date.getDate() / 7);
  return `${yy}-${mm} S${weekNum}`;
}

export function parseWeekLabel(value: string): number | null {
  const match = value.trim().match(/^(\d{2})-(\d{2})\s*S(\d+)$/i);
  if (!match) return null;
  const [, yy, mm, s] = match;
  return Number(yy) * 10000 + Number(mm) * 100 + Number(s);
}

export function isEligibleForCurrentSprint(cfValue: string | null | undefined, currentWeekKey: number): boolean {
  if (!cfValue) return false;
  const issueKey = parseWeekLabel(cfValue);
  // Not the expected "AA-MM SN" shape -- don't silently drop a legitimate
  // demand over an unexpected format, just let it through like before.
  if (issueKey === null) return true;
  return issueKey <= currentWeekKey;
}

// Used by sync/discover-people, which don't get an explicit week label from
// the caller: fall back to whatever week is currently active in the app, or
// to today's date if none exists yet.
export async function resolveCurrentWeekKey(db: SupabaseClient): Promise<number> {
  const { data: week } = await db.from("weeks").select("label").eq("is_current", true).maybeSingle();
  const key = week?.label ? parseWeekLabel(week.label) : null;
  if (key !== null && key !== undefined) return key;
  return parseWeekLabel(computeWeekLabel(new Date()))!;
}

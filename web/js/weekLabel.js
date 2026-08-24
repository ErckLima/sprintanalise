// Mirrors supabase/functions/_shared/weekLabel.ts's computeWeekLabel -- only
// used here to suggest a default when starting a week; the leader can always
// edit it (e.g. when S5 is being skipped in favor of next month's S1).
export function computeWeekLabel(date) {
  const yy = String(date.getFullYear() % 100).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const weekNum = Math.ceil(date.getDate() / 7);
  return `${yy}-${mm} S${weekNum}`;
}

export function computeNextMonthS1(date) {
  const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return computeWeekLabel(next);
}

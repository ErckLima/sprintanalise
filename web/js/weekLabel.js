// Mirrors supabase/functions/_shared/weekLabel.ts's computeWeekLabel/parseWeekLabel.
export function computeWeekLabel(date) {
  const yy = String(date.getFullYear() % 100).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const weekNum = Math.ceil(date.getDate() / 7);
  return `${yy}-${mm} S${weekNum}`;
}

export function parseWeekLabel(value) {
  const match = String(value).trim().match(/^(\d{2})-(\d{2})\s*S(\d+)$/i);
  if (!match) return null;
  const [, yy, mm, s] = match;
  return Number(yy) * 10000 + Number(mm) * 100 + Number(s);
}

export function computeNextMonthS1(date) {
  const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return computeWeekLabel(next);
}

// Candidates for the "which sprint is this" select when starting a week:
// a rolling window of real week-blocks around today (7-day steps handle
// month rollovers on their own) plus next month's S1 explicitly, in case
// S5 is being skipped and nothing else in the window already landed there.
export function generateWeekLabelOptions(today = new Date()) {
  const seen = new Set();
  const labels = [];

  for (let i = -1; i <= 3; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i * 7);
    const label = computeWeekLabel(d);
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }

  const nextMonthS1 = computeNextMonthS1(today);
  if (!seen.has(nextMonthS1)) labels.push(nextMonthS1);

  return labels.sort((a, b) => parseWeekLabel(a) - parseWeekLabel(b));
}

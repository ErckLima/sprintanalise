// Redmine's sprint custom field holds a week label like "26-08 S4" (2-digit
// year, 2-digit month, space, S + week-of-month, where week-of-month is a
// fixed 7-day block: day 1-7 = S1, 8-14 = S2, 15-21 = S3, 22-28 = S4, 29+ = S5).
// The leader now pre-fills future weeks so people can see what's coming, but
// a demand only enters the sprint once its own week has arrived -- current
// and every past week stay eligible (nothing drops out when a new week
// starts), only strictly future-labeled ones are excluded.
export function computeWeekLabel(date: Date): string {
  const yy = String(date.getFullYear() % 100).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const weekNum = Math.ceil(date.getDate() / 7);
  return `${yy}-${mm} S${weekNum}`;
}

function parseWeekLabel(value: string): number | null {
  const match = value.trim().match(/^(\d{2})-(\d{2})\s*S(\d+)$/i);
  if (!match) return null;
  const [, yy, mm, s] = match;
  return Number(yy) * 10000 + Number(mm) * 100 + Number(s);
}

export function isEligibleForCurrentSprint(cfValue: string | null | undefined, now: Date = new Date()): boolean {
  if (!cfValue) return false;
  const issueKey = parseWeekLabel(cfValue);
  // Not the expected "AA-MM SN" shape -- don't silently drop a legitimate
  // demand over an unexpected format, just let it through like before.
  if (issueKey === null) return true;
  const nowKey = parseWeekLabel(computeWeekLabel(now))!;
  return issueKey <= nowKey;
}

import { isEligibleForCurrentSprint } from "./weekLabel.ts";

export interface RedmineConfig {
  baseUrl: string;
  apiKey: string;
  trackerId: string;
  sprintCfId: string;
}

export interface RedmineIssue {
  id: number;
  subject: string;
  status: { id: number; name: string };
  assigned_to?: { id: number; name: string };
  custom_fields?: { id: number; name: string; value: unknown }[];
}

export interface RedmineStatus {
  id: number;
  name: string;
  is_closed: boolean;
}

export function loadRedmineConfig(): RedmineConfig {
  const baseUrl = Deno.env.get("REDMINE_BASE_URL");
  const apiKey = Deno.env.get("REDMINE_API_KEY");
  const trackerId = Deno.env.get("REDMINE_TRACKER_ID");
  const sprintCfId = Deno.env.get("SPRINT_CF_ID");
  if (!baseUrl || !apiKey || !trackerId || !sprintCfId) {
    throw new Error(
      "Configuração do Redmine incompleta (REDMINE_BASE_URL, REDMINE_API_KEY, REDMINE_TRACKER_ID, SPRINT_CF_ID).",
    );
  }
  // baseUrl must include the /redmine subpath in this instance — without it every call 404s.
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, trackerId, sprintCfId };
}

async function redmineFetch(cfg: RedmineConfig, path: string, params: Record<string, string>) {
  const url = new URL(cfg.baseUrl + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetch(url, { headers: { "X-Redmine-API-Key": cfg.apiKey } });
  if (!res.ok) {
    throw new Error(`Redmine ${path} respondeu ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function sprintFilterParams(cfg: RedmineConfig, assignedToId?: number): Record<string, string> {
  const params: Record<string, string> = {
    status_id: "o",
    tracker_id: cfg.trackerId,
    [`cf_${cfg.sprintCfId}`]: "*",
  };
  if (assignedToId != null) params.assigned_to_id = String(assignedToId);
  return params;
}

export async function fetchSprintIssues(cfg: RedmineConfig, assignedToId?: number): Promise<RedmineIssue[]> {
  const issues: RedmineIssue[] = [];
  const limit = 100;
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const data = await redmineFetch(cfg, "/issues.json", {
      ...sprintFilterParams(cfg, assignedToId),
      limit: String(limit),
      offset: String(offset),
    });
    issues.push(...(data.issues ?? []));
    total = data.total_count ?? issues.length;
    offset += limit;
  }
  // The Redmine filter only checks the sprint field is non-empty -- the
  // leader pre-fills future weeks too, so a demand only really counts once
  // its own week is current or already past.
  return issues.filter((issue) => isEligibleForCurrentSprint(sprintCfValue(cfg, issue)));
}

export async function fetchIssuesForPeople(
  cfg: RedmineConfig,
  redmineUserIds: number[],
): Promise<Map<number, RedmineIssue[]>> {
  const entries = await Promise.all(
    redmineUserIds.map(async (id) => [id, await fetchSprintIssues(cfg, id)] as const),
  );
  return new Map(entries);
}

export async function fetchIssueById(cfg: RedmineConfig, issueId: number): Promise<RedmineIssue | null> {
  try {
    const data = await redmineFetch(cfg, `/issues/${issueId}.json`, {});
    return data.issue ?? null;
  } catch {
    return null;
  }
}

export async function fetchIssuesByIds(
  cfg: RedmineConfig,
  issueIds: number[],
): Promise<Map<number, RedmineIssue | null>> {
  const entries = await Promise.all(
    issueIds.map(async (id) => [id, await fetchIssueById(cfg, id)] as const),
  );
  return new Map(entries);
}

export async function fetchIssueStatuses(cfg: RedmineConfig): Promise<RedmineStatus[]> {
  const data = await redmineFetch(cfg, "/issue_statuses.json", {});
  return data.issue_statuses ?? [];
}

export function sprintCfValue(cfg: RedmineConfig, issue: RedmineIssue): string | null {
  const cf = issue.custom_fields?.find((f) => f.id === Number(cfg.sprintCfId));
  if (cf == null || cf.value == null) return null;
  return String(cf.value);
}

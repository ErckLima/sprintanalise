import { corsHeaders, json } from "../_shared/cors.ts";
import { fetchIssuesForPeople, loadRedmineConfig, sprintCfValue } from "../_shared/redmine.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { learnCustomFieldDefs, refreshIssueStatuses } from "../_shared/caches.ts";
import { touchIssueHistory } from "../_shared/history.ts";
import { discoverAndUpsertPeople } from "../_shared/roster.ts";
import { timingSafeEqual } from "../_shared/timingSafeEqual.ts";
import { computeWeekLabel, parseWeekLabel } from "../_shared/weekLabel.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body: { password?: string; weekLabel?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "JSON inválido" }, 400);
  }

  const expectedPassword = Deno.env.get("START_WEEK_PASSWORD") ?? "";
  if (!body.password || !timingSafeEqual(body.password, expectedPassword)) {
    return json({ ok: false, error: "Senha inválida" }, 401);
  }

  // The leader picks which sprint week this is (S5 is often skipped in
  // favor of next month's S1) -- computeWeekLabel(today) is only a fallback
  // for callers that don't send one.
  const requestedLabel = typeof body.weekLabel === "string" ? body.weekLabel.trim() : "";
  const weekLabel = parseWeekLabel(requestedLabel) !== null ? requestedLabel : computeWeekLabel(new Date());
  const currentWeekKey = parseWeekLabel(weekLabel)!;

  const db = supabaseAdmin();
  const startedAt = new Date().toISOString();

  try {
    const cfg = loadRedmineConfig();

    await discoverAndUpsertPeople(db, cfg, currentWeekKey);
    const { data: activePeople, error: activeErr } = await db.from("people").select("*").eq("active", true);
    if (activeErr) throw activeErr;

    const { error: closeErr } = await db.from("weeks").update({ is_current: false }).eq("is_current", true);
    if (closeErr) throw closeErr;

    const today = new Date();
    const { data: newWeek, error: weekErr } = await db
      .from("weeks")
      .insert({
        label: weekLabel,
        start_date: today.toISOString().slice(0, 10),
        started_at: startedAt,
        is_current: true,
      })
      .select()
      .single();
    if (weekErr) throw weekErr;

    const statusMap = await refreshIssueStatuses(db, cfg);
    const issuesByPerson = await fetchIssuesForPeople(cfg, currentWeekKey, (activePeople ?? []).map((p: any) => p.redmine_user_id));
    const allIssues = Array.from(issuesByPerson.values()).flat();
    await learnCustomFieldDefs(db, allIssues);

    const allIssueIds = allIssues.map((i) => i.id);
    const alreadyInHistory = await touchIssueHistory(db, newWeek.id, allIssueIds, true);

    const now = new Date().toISOString();
    const baselineRows: any[] = [];
    const stateRows: any[] = [];
    const events: any[] = [];
    let issuesSeen = 0;

    for (const person of activePeople ?? []) {
      const issues = issuesByPerson.get(person.redmine_user_id) ?? [];
      for (const issue of issues) {
        issuesSeen++;
        const cfValue = sprintCfValue(cfg, issue);
        const isClosed = statusMap.get(issue.status.id)?.is_closed ?? false;
        const isCarryover = alreadyInHistory.get(issue.id) ?? false;

        baselineRows.push({
          week_id: newWeek.id,
          person_id: person.id,
          issue_id: issue.id,
          subject: issue.subject,
          status_id: issue.status.id,
          status_name: issue.status.name,
          sprint_cf_value: cfValue,
          is_carryover: isCarryover,
          captured_at: now,
        });
        stateRows.push({
          week_id: newWeek.id,
          person_id: person.id,
          issue_id: issue.id,
          subject: issue.subject,
          status_id: issue.status.id,
          status_name: issue.status.name,
          sprint_cf_value: cfValue,
          present_in_sprint: true,
          is_closed: isClosed,
          last_polled_at: now,
        });
        events.push({
          week_id: newWeek.id,
          person_id: person.id,
          issue_id: issue.id,
          event_type: "added",
          to_status: issue.status.name,
          source: "week_start",
          detected_at: now,
        });
      }
    }

    if (baselineRows.length > 0) {
      const { error } = await db.from("week_baseline_issues").insert(baselineRows);
      if (error) throw error;
    }
    if (stateRows.length > 0) {
      const { error } = await db.from("issue_current_state").insert(stateRows);
      if (error) throw error;
    }
    if (events.length > 0) {
      const { error } = await db.from("issue_events").insert(events);
      if (error) throw error;
    }

    await db.from("sync_runs").insert({
      trigger_type: "week_start",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "success",
      people_synced: (activePeople ?? []).length,
      issues_seen: issuesSeen,
      events_created: events.length,
    });

    return json({ ok: true, week: newWeek, people_synced: (activePeople ?? []).length, issues_seen: issuesSeen });
  } catch (err) {
    await db.from("sync_runs").insert({
      trigger_type: "week_start",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "error",
      error_message: String((err as Error)?.message ?? err),
    });
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});

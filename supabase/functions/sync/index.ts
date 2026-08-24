import { corsHeaders, json } from "../_shared/cors.ts";
import { fetchIssuesByIds, fetchIssuesForPeople, loadRedmineConfig, sprintCfValue } from "../_shared/redmine.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { learnCustomFieldDefs, refreshIssueStatuses } from "../_shared/caches.ts";
import { touchIssueHistory } from "../_shared/history.ts";
import { computeWeekLabel, parseWeekLabel } from "../_shared/weekLabel.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const db = supabaseAdmin();
  const startedAt = new Date().toISOString();
  let peopleSynced = 0;
  let issuesSeen = 0;
  let eventsCreated = 0;

  try {
    const cfg = loadRedmineConfig();

    const { data: week, error: weekErr } = await db.from("weeks").select("*").eq("is_current", true).maybeSingle();
    if (weekErr) throw weekErr;
    if (!week) {
      await db.from("sync_runs").insert({
        trigger_type: "manual_sync",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: "skipped",
        error_message: "Nenhuma semana ativa. Rode 'Iniciar a Semana' primeiro.",
      });
      return json({ ok: false, error: "Nenhuma semana ativa. Rode 'Iniciar a Semana' primeiro." }, 409);
    }

    const { data: people, error: peopleErr } = await db.from("people").select("*").eq("active", true);
    if (peopleErr) throw peopleErr;
    peopleSynced = people?.length ?? 0;

    const statusMap = await refreshIssueStatuses(db, cfg);

    // The active week's own label is the eligibility boundary -- not
    // today's date -- so it stays consistent with whatever the leader chose
    // when starting this week (e.g. skipping S5 straight to next month's S1).
    const currentWeekKey = (week.label ? parseWeekLabel(week.label) : null) ?? parseWeekLabel(computeWeekLabel(new Date()))!;

    const issuesByPerson = await fetchIssuesForPeople(cfg, currentWeekKey, (people ?? []).map((p: any) => p.redmine_user_id));
    const allFetchedIssues = Array.from(issuesByPerson.values()).flat();
    await learnCustomFieldDefs(db, allFetchedIssues);

    const { data: prevStateRows, error: prevErr } = await db
      .from("issue_current_state")
      .select("*")
      .eq("week_id", week.id)
      .eq("present_in_sprint", true);
    if (prevErr) throw prevErr;
    const prevStateMap = new Map((prevStateRows ?? []).map((r: any) => [r.issue_id, r]));

    const { data: baselineRows, error: baseErr } = await db
      .from("week_baseline_issues")
      .select("issue_id, status_id")
      .eq("week_id", week.id);
    if (baseErr) throw baseErr;
    const baselineStatusMap = new Map((baselineRows ?? []).map((r: any) => [r.issue_id, r.status_id]));

    const now = new Date().toISOString();
    const seenIssueIds = new Set<number>();
    const stateUpserts: any[] = [];
    const events: any[] = [];

    for (const person of people ?? []) {
      const issues = issuesByPerson.get(person.redmine_user_id) ?? [];
      for (const issue of issues) {
        issuesSeen++;
        seenIssueIds.add(issue.id);
        const previous = prevStateMap.get(issue.id);
        const cfValue = sprintCfValue(cfg, issue);
        const isClosed = statusMap.get(issue.status.id)?.is_closed ?? false;

        stateUpserts.push({
          week_id: week.id,
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

        if (!previous) {
          events.push({
            week_id: week.id,
            person_id: person.id,
            issue_id: issue.id,
            event_type: "added",
            to_status: issue.status.name,
            source: "manual_sync",
            detected_at: now,
          });
        } else if (previous.status_id !== issue.status.id) {
          const baselineStatusId = baselineStatusMap.get(issue.id);
          const isRevert = baselineStatusId != null &&
            issue.status.id === baselineStatusId &&
            previous.status_id !== baselineStatusId;
          events.push({
            week_id: week.id,
            person_id: person.id,
            issue_id: issue.id,
            event_type: isRevert ? "reverted_to_original" : "status_changed",
            from_status: previous.status_name,
            to_status: issue.status.name,
            source: "manual_sync",
            detected_at: now,
          });
        }
      }
    }

    // Issues that were present last poll but didn't come back in the filter this time:
    // could be completed OR just kicked out of the sprint (both leave the "open" filter
    // the same way), so resolve each one directly by id.
    const disappearedIds = Array.from(prevStateMap.keys()).filter((id) => !seenIssueIds.has(id));
    if (disappearedIds.length > 0) {
      const lookedUp = await fetchIssuesByIds(cfg, disappearedIds);
      for (const issueId of disappearedIds) {
        const previous = prevStateMap.get(issueId)!;
        const fetched = lookedUp.get(issueId);

        let statusId = previous.status_id;
        let statusName = previous.status_name;
        let isClosed = previous.is_closed;
        let cfValue = previous.sprint_cf_value;
        let eventType: string;

        if (fetched) {
          statusId = fetched.status.id;
          statusName = fetched.status.name;
          isClosed = statusMap.get(fetched.status.id)?.is_closed ?? false;
          cfValue = sprintCfValue(cfg, fetched);
          eventType = isClosed ? "completed" : "removed_from_sprint";
        } else {
          eventType = "removed_from_sprint";
        }

        stateUpserts.push({
          week_id: week.id,
          person_id: previous.person_id,
          issue_id: issueId,
          subject: fetched?.subject ?? previous.subject,
          status_id: statusId,
          status_name: statusName,
          sprint_cf_value: cfValue,
          present_in_sprint: false,
          is_closed: isClosed,
          last_polled_at: now,
        });
        events.push({
          week_id: week.id,
          person_id: previous.person_id,
          issue_id: issueId,
          event_type: eventType,
          from_status: previous.status_name,
          to_status: statusName,
          source: "manual_sync",
          detected_at: now,
        });
      }
    }

    if (stateUpserts.length > 0) {
      const { error } = await db.from("issue_current_state").upsert(stateUpserts, { onConflict: "week_id,issue_id" });
      if (error) throw error;
    }
    if (events.length > 0) {
      const { error } = await db.from("issue_events").insert(events);
      if (error) throw error;
      eventsCreated = events.length;
    }

    await touchIssueHistory(db, week.id, Array.from(seenIssueIds), false);

    await db.from("sync_runs").insert({
      trigger_type: "manual_sync",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "success",
      people_synced: peopleSynced,
      issues_seen: issuesSeen,
      events_created: eventsCreated,
    });

    return json({ ok: true, people_synced: peopleSynced, issues_seen: issuesSeen, events_created: eventsCreated });
  } catch (err) {
    await db.from("sync_runs").insert({
      trigger_type: "manual_sync",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "error",
      people_synced: peopleSynced,
      issues_seen: issuesSeen,
      events_created: eventsCreated,
      error_message: String((err as Error)?.message ?? err),
    });
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});

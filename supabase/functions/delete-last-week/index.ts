import { corsHeaders, json } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { timingSafeEqual } from "../_shared/timingSafeEqual.ts";

// Only ever targets the highest-id week — there is no way to pick an older
// one, which is what keeps this an "undo the last start-week" action instead
// of a general week-deletion tool.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "JSON inválido" }, 400);
  }

  const expectedPassword = Deno.env.get("START_WEEK_PASSWORD") ?? "";
  if (!body.password || !timingSafeEqual(body.password, expectedPassword)) {
    return json({ ok: false, error: "Senha inválida" }, 401);
  }

  const db = supabaseAdmin();

  try {
    const { data: week, error: weekErr } = await db
      .from("weeks")
      .select("*")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (weekErr) throw weekErr;
    if (!week) return json({ ok: false, error: "Nenhuma semana para excluir." }, 404);

    const { data: baselineIssues, error: baselineErr } = await db
      .from("week_baseline_issues")
      .select("issue_id")
      .eq("week_id", week.id);
    if (baselineErr) throw baselineErr;
    const baselineIssueIds = new Set((baselineIssues ?? []).map((r: any) => r.issue_id));

    // issue_history rows touched by this week: ones first seen *in* this
    // week have no history without it (delete them); ones that already
    // existed just need last_seen_* rewound to their prior sighting.
    const { data: historyRows, error: historyErr } = await db
      .from("issue_history")
      .select("*")
      .or(`first_seen_week_id.eq.${week.id},last_seen_week_id.eq.${week.id}`);
    if (historyErr) throw historyErr;

    const toDeleteIssueIds: number[] = [];
    const rewinds: { issue_id: number; last_seen_week_id: number; last_seen_at: string; times_seen_as_baseline: number }[] = [];

    for (const h of historyRows ?? []) {
      if (h.first_seen_week_id === week.id) {
        toDeleteIssueIds.push(h.issue_id);
        continue;
      }
      if (h.last_seen_week_id === week.id) {
        const { data: priorState } = await db
          .from("issue_current_state")
          .select("week_id, last_polled_at")
          .eq("issue_id", h.issue_id)
          .neq("week_id", week.id)
          .order("last_polled_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        rewinds.push({
          issue_id: h.issue_id,
          last_seen_week_id: priorState?.week_id ?? h.first_seen_week_id,
          last_seen_at: priorState?.last_polled_at ?? h.first_seen_at,
          times_seen_as_baseline: Math.max(
            0,
            h.times_seen_as_baseline - (baselineIssueIds.has(h.issue_id) ? 1 : 0),
          ),
        });
      }
    }

    if (toDeleteIssueIds.length > 0) {
      const { error } = await db.from("issue_history").delete().in("issue_id", toDeleteIssueIds);
      if (error) throw error;
    }
    for (const r of rewinds) {
      const { error } = await db
        .from("issue_history")
        .update({
          last_seen_week_id: r.last_seen_week_id,
          last_seen_at: r.last_seen_at,
          times_seen_as_baseline: r.times_seen_as_baseline,
        })
        .eq("issue_id", r.issue_id);
      if (error) throw error;
    }

    // Children before parent — FKs reference weeks(id) with no cascade.
    const { error: eventsErr } = await db.from("issue_events").delete().eq("week_id", week.id);
    if (eventsErr) throw eventsErr;
    const { error: baselineDelErr } = await db.from("week_baseline_issues").delete().eq("week_id", week.id);
    if (baselineDelErr) throw baselineDelErr;
    const { error: stateErr } = await db.from("issue_current_state").delete().eq("week_id", week.id);
    if (stateErr) throw stateErr;
    const { error: weekDelErr } = await db.from("weeks").delete().eq("id", week.id);
    if (weekDelErr) throw weekDelErr;

    const { data: previousWeek, error: prevErr } = await db
      .from("weeks")
      .select("*")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prevErr) throw prevErr;

    if (previousWeek) {
      const { error } = await db.from("weeks").update({ is_current: true }).eq("id", previousWeek.id);
      if (error) throw error;
    }

    return json({
      ok: true,
      deleted_week: { id: week.id, label: week.label },
      restored_current_week: previousWeek ? { id: previousWeek.id, label: previousWeek.label } : null,
    });
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});

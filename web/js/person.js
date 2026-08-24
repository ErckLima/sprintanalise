import { supabase } from "./supabaseClient.js";
import { REDMINE_BASE_URL } from "./config.js";
import { escapeHtml, eventBadgeClass, eventLabel, formatDateTime } from "./format.js";

const params = new URLSearchParams(location.search);
const personId = params.get("id");

async function load() {
  const nameEl = document.getElementById("person-name");
  const list = document.getElementById("timeline");

  if (!personId) {
    nameEl.textContent = "Pessoa não especificada";
    return;
  }

  const { data: person, error: personErr } = await supabase.from("people").select("*").eq("id", personId).single();
  if (personErr || !person) {
    nameEl.textContent = "Pessoa não encontrada";
    return;
  }
  nameEl.textContent = person.display_name;

  const [{ data: events }, { data: states }] = await Promise.all([
    supabase
      .from("issue_events")
      .select("*, weeks(label)")
      .eq("person_id", personId)
      .order("detected_at", { ascending: false }),
    supabase
      .from("issue_current_state")
      .select("issue_id, subject, sprint_cf_value, last_polled_at")
      .eq("person_id", personId),
  ]);

  const subjectByIssue = new Map();
  for (const s of states ?? []) {
    const prev = subjectByIssue.get(s.issue_id);
    if (!prev || s.last_polled_at > prev.last_polled_at) subjectByIssue.set(s.issue_id, s);
  }

  list.innerHTML = "";
  if (!events || events.length === 0) {
    list.innerHTML = `<li class="issue-empty">Nenhum evento registrado ainda.</li>`;
    return;
  }

  for (const ev of events) {
    const state = subjectByIssue.get(ev.issue_id);
    const subject = state?.subject ?? `Issue #${ev.issue_id}`;
    const sprintTag = state?.sprint_cf_value
      ? `<span class="tag-sprint" title="Sprint desta demanda">${escapeHtml(state.sprint_cf_value)}</span>`
      : "";
    const transition = ev.from_status && ev.to_status
      ? `<span class="transition">${escapeHtml(ev.from_status)} → ${escapeHtml(ev.to_status)}</span>`
      : "";
    const li = document.createElement("li");
    li.className = "timeline-item";
    li.innerHTML = `
      <span class="timeline-date">${formatDateTime(ev.detected_at)}</span>
      ${sprintTag}
      <a href="${REDMINE_BASE_URL}/issues/${ev.issue_id}" target="_blank" rel="noopener">#${ev.issue_id} ${escapeHtml(subject)}</a>
      <span class="badge ${eventBadgeClass(ev.event_type)}">${escapeHtml(eventLabel(ev.event_type))}</span>
      ${transition}
      <span class="timeline-week">${escapeHtml(ev.weeks?.label ?? "")}</span>
    `;
    list.appendChild(li);
  }
}

load();

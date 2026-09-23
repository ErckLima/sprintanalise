import { REDMINE_BASE_URL } from "./config.js";
import { escapeHtml, eventBadgeClass, eventLabel, priorityBadgeClass } from "./format.js";

// Highest priority first; anything unrecognized sinks to the bottom instead
// of erroring.
const PRIORITY_RANK = { Imediata: 0, Urgente: 1, Alta: 2, Normal: 3, Baixa: 4 };
function priorityRank(name) {
  return PRIORITY_RANK[name] ?? 99;
}
function isRemoved(item) {
  return item.eventsByType?.has("removed_from_sprint") ?? false;
}
function byPriority(a, b) {
  // Removed-from-sprint demands always float to the top regardless of
  // priority -- they need eyes on them before anything else.
  const removedDiff = Number(isRemoved(b)) - Number(isRemoved(a));
  if (removedDiff !== 0) return removedDiff;
  return priorityRank(a.row.priority_name) - priorityRank(b.row.priority_name);
}

// Shared between the dashboard (current week only) and the weeks overview
// (any week) so both render issue lists the same way.
//
// eventsByIssue is Map<issueId, Map<eventType, latestEventOfThatType>> --
// an issue can legitimately rack up more than one distinct event type in the
// same week (e.g. added mid-week, then its status changed), and each one
// needs its own badge rather than the newest event hiding the others.
export function groupIssuesForPerson(personId, currentStateByPerson, baselineByIssue, eventsByIssue) {
  const rows = currentStateByPerson.get(personId) ?? [];
  const changed = [];
  const unchanged = [];

  for (const row of rows) {
    const baseline = baselineByIssue.get(row.issue_id);
    const eventsByType = eventsByIssue.get(row.issue_id);
    const isNew = !baseline;
    const hasEvents = eventsByType && eventsByType.size > 0;
    const item = { row, baseline, eventsByType, isNew };
    if (hasEvents || isNew) changed.push(item);
    else unchanged.push(item);
  }

  changed.sort(byPriority);
  unchanged.sort(byPriority);

  return { changed, unchanged };
}

export function renderIssueSectionsHtml(changed, unchanged) {
  return `
    <section class="issue-section">
      <h3>Alteradas, novas ou removidas (${changed.length})</h3>
      <ul class="issue-list">${changed.map(renderIssueItem).join("") || emptyIssueRow()}</ul>
    </section>
    <section class="issue-section">
      <h3>Sem alteração (${unchanged.length})</h3>
      <ul class="issue-list">${unchanged.map(renderIssueItem).join("") || emptyIssueRow()}</ul>
    </section>
  `;
}

function emptyIssueRow() {
  return `<li class="issue-empty">Nada por aqui.</li>`;
}

// Fixed order so badges read consistently regardless of which order the
// events happened to fire in (e.g. always "Adicionada" before "Mudou status").
const EVENT_TYPE_ORDER = ["added", "status_changed", "reverted_to_original", "completed", "removed_from_sprint"];

export function renderIssueItem({ row, baseline, eventsByType, isNew }) {
  const url = `${REDMINE_BASE_URL}/issues/${row.issue_id}`;
  const types = new Set(eventsByType ? eventsByType.keys() : []);
  if (isNew) types.add("added"); // safety net if an "added" event is somehow missing

  const badges = [];
  const transitions = [];
  for (const type of EVENT_TYPE_ORDER) {
    if (!types.has(type)) continue;
    badges.push(`<span class="badge ${eventBadgeClass(type)}">${escapeHtml(eventLabel(type))}</span>`);
    const ev = eventsByType?.get(type);
    if (ev?.from_status && ev?.to_status) {
      transitions.push(`<span class="transition">${escapeHtml(ev.from_status)} → ${escapeHtml(ev.to_status)}</span>`);
    }
  }

  const carryoverTag = baseline?.is_carryover
    ? '<span class="tag-carryover" title="Também estava na sprint imediatamente anterior">transbordo</span>'
    : "";

  const sprintTag = row.sprint_cf_value
    ? `<span class="tag-sprint" title="Sprint desta demanda">${escapeHtml(row.sprint_cf_value)}</span>`
    : "";

  const priorityTag = row.priority_name
    ? `<span class="badge ${priorityBadgeClass(row.priority_name)}" title="Prioridade">${escapeHtml(row.priority_name)}</span>`
    : "";

  return `
    <li class="issue-item">
      ${priorityTag}
      ${sprintTag}
      <a href="${url}" target="_blank" rel="noopener">#${row.issue_id} ${escapeHtml(row.subject ?? "")}</a>
      <span class="status-name">${escapeHtml(row.status_name ?? "")}</span>
      ${transitions.join("")}
      ${badges.join("")}
      ${carryoverTag}
    </li>
  `;
}

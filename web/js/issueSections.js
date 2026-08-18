import { REDMINE_BASE_URL } from "./config.js";
import { escapeHtml, eventBadgeClass, eventLabel } from "./format.js";

// Shared between the dashboard (current week only) and the weeks overview
// (any week) so both render issue lists the same way.
export function groupIssuesForPerson(personId, currentStateByPerson, baselineByIssue, changedEventByIssue) {
  const rows = currentStateByPerson.get(personId) ?? [];
  const changed = [];
  const unchanged = [];

  for (const row of rows) {
    const baseline = baselineByIssue.get(row.issue_id);
    const event = changedEventByIssue.get(row.issue_id);
    const isNew = !baseline;
    const item = { row, baseline, event };
    if (event || isNew) changed.push(item);
    else unchanged.push(item);
  }

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

export function renderIssueItem({ row, baseline, event }) {
  const url = `${REDMINE_BASE_URL}/issues/${row.issue_id}`;
  let badge = "";
  let transition = "";

  if (event) {
    badge = `<span class="badge ${eventBadgeClass(event.event_type)}">${escapeHtml(eventLabel(event.event_type))}</span>`;
    if (event.from_status && event.to_status) {
      transition = `<span class="transition">${escapeHtml(event.from_status)} → ${escapeHtml(event.to_status)}</span>`;
    }
  } else if (!baseline) {
    badge = `<span class="badge badge-added">Adicionada</span>`;
  }

  const carryoverTag = baseline?.is_carryover
    ? '<span class="tag-carryover" title="Já vinha de sprints anteriores">retrabalho</span>'
    : "";

  return `
    <li class="issue-item">
      <a href="${url}" target="_blank" rel="noopener">#${row.issue_id} ${escapeHtml(row.subject ?? "")}</a>
      <span class="status-name">${escapeHtml(row.status_name ?? "")}</span>
      ${transition}
      ${badge}
      ${carryoverTag}
    </li>
  `;
}

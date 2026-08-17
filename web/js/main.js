import { supabase } from "./supabaseClient.js";
import { REDMINE_BASE_URL } from "./config.js";
import { escapeHtml, eventBadgeClass, eventLabel } from "./format.js";

const HIDDEN_KEY = "sprintanalise_hidden_people";

function getHidden() {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function setHidden(set) {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(Array.from(set)));
}

let state = {
  people: [],
  week: null,
  latestWeek: null,
  currentStateByPerson: new Map(),
  baselineByIssue: new Map(),
  changedEventByIssue: new Map(),
};

async function loadData() {
  const { data: people, error: peopleErr } = await supabase.from("people").select("*").order("display_order");
  if (peopleErr) throw peopleErr;

  const { data: week } = await supabase.from("weeks").select("*").eq("is_current", true).maybeSingle();
  const { data: latestWeekRows } = await supabase
    .from("weeks")
    .select("*")
    .order("id", { ascending: false })
    .limit(1);
  const latestWeek = latestWeekRows?.[0] ?? null;

  const currentStateByPerson = new Map();
  const baselineByIssue = new Map();
  const changedEventByIssue = new Map();

  if (week) {
    const { data: currentStates } = await supabase.from("issue_current_state").select("*").eq("week_id", week.id);
    for (const row of currentStates ?? []) {
      if (!currentStateByPerson.has(row.person_id)) currentStateByPerson.set(row.person_id, []);
      currentStateByPerson.get(row.person_id).push(row);
    }

    const { data: baselineRows } = await supabase.from("week_baseline_issues").select("*").eq("week_id", week.id);
    for (const row of baselineRows ?? []) baselineByIssue.set(row.issue_id, row);

    // Ascending order so the last write wins -> map ends up holding the most
    // recent non-baseline event per issue (used both as "did it change" and
    // as the badge/de-para source).
    const { data: events } = await supabase
      .from("issue_events")
      .select("*")
      .eq("week_id", week.id)
      .neq("source", "week_start")
      .order("detected_at", { ascending: true });
    for (const ev of events ?? []) changedEventByIssue.set(ev.issue_id, ev);
  }

  state = { people: people ?? [], week, latestWeek, currentStateByPerson, baselineByIssue, changedEventByIssue };
}

function render() {
  const hidden = getHidden();
  renderHiddenDropdown(hidden);
  renderWeekBanner();

  const deleteBtn = document.getElementById("delete-week-btn");
  deleteBtn.disabled = !state.latestWeek;
  deleteBtn.textContent = state.latestWeek
    ? `Excluir última semana (${state.latestWeek.label ?? state.latestWeek.start_date})`
    : "Excluir última semana";

  const container = document.getElementById("people-list");
  container.innerHTML = "";

  if (!state.week) {
    container.innerHTML = `<p class="empty-state">Nenhuma semana ativa ainda. Clique em "Iniciar a Semana" para começar.</p>`;
    return;
  }

  const visiblePeople = state.people.filter((p) => p.active && !hidden.has(p.id));

  if (visiblePeople.length === 0) {
    container.innerHTML = `<p class="empty-state">Nenhuma pessoa visível. Ajuste o filtro "Mostrar pessoas".</p>`;
    return;
  }

  const orderedAll = [...state.people].filter((p) => p.active).sort((a, b) => a.display_order - b.display_order);
  const total = orderedAll.length;

  for (const person of visiblePeople) {
    const position = orderedAll.findIndex((p) => p.id === person.id) + 1;
    container.appendChild(renderPersonCard(person, position, total));
  }
}

function renderPersonCard(person, position, total) {
  const rows = state.currentStateByPerson.get(person.id) ?? [];
  const changed = [];
  const unchanged = [];

  for (const row of rows) {
    const baseline = state.baselineByIssue.get(row.issue_id);
    const event = state.changedEventByIssue.get(row.issue_id);
    const isNew = !baseline;
    const item = { row, baseline, event, isNew };
    if (event || isNew) changed.push(item);
    else unchanged.push(item);
  }

  const card = document.createElement("article");
  card.className = "person-card";
  card.innerHTML = `
    <header class="person-card-header">
      <input
        type="number"
        class="order-input"
        data-id="${person.id}"
        value="${position}"
        min="1"
        max="${total}"
        title="Posição na ordem de apresentação"
      />
      <a class="person-name" href="person.html?id=${person.id}">${escapeHtml(person.display_name)}</a>
    </header>
    <section class="issue-section">
      <h3>Alteradas, novas ou removidas (${changed.length})</h3>
      <ul class="issue-list">${changed.map(renderIssueItem).join("") || emptyIssueRow()}</ul>
    </section>
    <section class="issue-section">
      <h3>Sem alteração (${unchanged.length})</h3>
      <ul class="issue-list">${unchanged.map(renderIssueItem).join("") || emptyIssueRow()}</ul>
    </section>
  `;
  return card;
}

function emptyIssueRow() {
  return `<li class="issue-empty">Nada por aqui.</li>`;
}

function renderIssueItem({ row, baseline, event }) {
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

function renderWeekBanner() {
  const el = document.getElementById("week-banner");
  el.textContent = state.week ? `Semana atual: ${state.week.label ?? state.week.start_date}` : "Nenhuma semana ativa";
}

function renderHiddenDropdown(hidden) {
  const list = document.getElementById("hidden-people-list");
  const summary = document.getElementById("hidden-people-summary");
  const activePeople = state.people.filter((p) => p.active);
  const total = activePeople.length;
  const visible = activePeople.filter((p) => !hidden.has(p.id)).length;
  summary.textContent = `Mostrar pessoas (${visible}/${total})`;

  list.innerHTML = "";
  for (const person of activePeople) {
    const label = document.createElement("label");
    label.className = "hidden-people-item";
    label.innerHTML = `<input type="checkbox" data-id="${person.id}" ${hidden.has(person.id) ? "" : "checked"}> ${escapeHtml(person.display_name)}`;
    list.appendChild(label);
  }
}

async function withButtonBusy(button, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Aguarde...";
  try {
    await fn();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function showStatus(message, isError = false) {
  const el = document.getElementById("status-message");
  el.textContent = message;
  el.className = isError ? "status-message status-error" : "status-message status-ok";
}

async function refreshAndRender() {
  await loadData();
  render();
}

function setupEvents() {
  document.getElementById("sync-btn").addEventListener("click", (e) => {
    withButtonBusy(e.currentTarget, async () => {
      const { data, error } = await supabase.functions.invoke("sync", { body: {} });
      if (error) return showStatus(`Erro ao atualizar: ${error.message}`, true);
      if (!data?.ok) return showStatus(`Erro ao atualizar: ${data?.error}`, true);
      showStatus(`Atualizado: ${data.events_created} evento(s) novo(s).`);
      await refreshAndRender();
    });
  });

  document.getElementById("discover-btn").addEventListener("click", (e) => {
    withButtonBusy(e.currentTarget, async () => {
      const { data, error } = await supabase.functions.invoke("discover-people", { body: {} });
      if (error) return showStatus(`Erro ao buscar pessoas: ${error.message}`, true);
      if (!data?.ok) return showStatus(`Erro ao buscar pessoas: ${data?.error}`, true);
      showStatus(`Roster atualizado: ${data.people.length} pessoa(s).`);
      await refreshAndRender();
    });
  });

  document.getElementById("start-week-btn").addEventListener("click", (e) => {
    const password = prompt("Senha para iniciar a semana:");
    if (!password) return;
    if (!confirm("Isso fecha a semana atual e captura uma nova baseline. Confirma?")) return;
    withButtonBusy(e.currentTarget, async () => {
      const { data, error } = await supabase.functions.invoke("start-week", { body: { password } });
      if (error) return showStatus(`Erro ao iniciar semana: ${error.message}`, true);
      if (!data?.ok) return showStatus(`Erro ao iniciar semana: ${data?.error}`, true);
      showStatus(`Semana iniciada: ${data.issues_seen} issue(s) capturada(s).`);
      await refreshAndRender();
    });
  });

  document.getElementById("delete-week-btn").addEventListener("click", (e) => {
    if (!state.latestWeek) return;
    const password = prompt("Senha para excluir a última semana:");
    if (!password) return;
    const label = state.latestWeek.label ?? state.latestWeek.start_date;
    if (!confirm(`Isso exclui PERMANENTEMENTE a semana "${label}" e todos os dados dela. Só é possível excluir a última semana gerada. Confirma?`)) return;
    withButtonBusy(e.currentTarget, async () => {
      const { data, error } = await supabase.functions.invoke("delete-last-week", { body: { password } });
      if (error) return showStatus(`Erro ao excluir semana: ${error.message}`, true);
      if (!data?.ok) return showStatus(`Erro ao excluir semana: ${data?.error}`, true);
      showStatus(`Semana "${data.deleted_week.label}" excluída.`);
      await refreshAndRender();
    });
  });

  document.getElementById("hidden-people-toggle").addEventListener("click", () => {
    document.getElementById("hidden-people-panel").classList.toggle("open");
  });

  document.getElementById("hidden-people-list").addEventListener("change", (e) => {
    const id = Number(e.target.dataset.id);
    const hidden = getHidden();
    if (e.target.checked) hidden.delete(id);
    else hidden.add(id);
    setHidden(hidden);
    render();
  });

  document.getElementById("people-list").addEventListener("change", async (e) => {
    const input = e.target.closest(".order-input");
    if (!input) return;
    const id = Number(input.dataset.id);
    const ordered = [...state.people].filter((p) => p.active).sort((a, b) => a.display_order - b.display_order);
    const fromIdx = ordered.findIndex((p) => p.id === id);
    if (fromIdx === -1) return;

    let toIdx = Math.round(Number(input.value)) - 1;
    toIdx = Math.max(0, Math.min(ordered.length - 1, toIdx));
    if (toIdx === fromIdx) {
      input.value = fromIdx + 1;
      return;
    }

    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);

    const { error } = await supabase.rpc("reorder_people", { p_ids: ordered.map((p) => p.id) });
    if (error) return showStatus(`Erro ao reordenar: ${error.message}`, true);
    await refreshAndRender();
  });
}

async function init() {
  setupEvents();
  try {
    await refreshAndRender();
  } catch (err) {
    showStatus(`Erro ao carregar dados: ${err.message}`, true);
  }
}

init();

import { supabase } from "./supabaseClient.js";
import { escapeHtml } from "./format.js";
import { groupIssuesForPerson, renderIssueSectionsHtml } from "./issueSections.js";

async function load() {
  const container = document.getElementById("weeks-list");

  const [{ data: weeks, error: weeksErr }, { data: people, error: peopleErr }] = await Promise.all([
    supabase.from("weeks").select("*").order("id", { ascending: false }),
    supabase.from("people").select("*").order("display_order"),
  ]);

  if (weeksErr || peopleErr) {
    container.innerHTML = `<p class="empty-state">Erro ao carregar: ${escapeHtml((weeksErr ?? peopleErr).message)}</p>`;
    return;
  }

  if (!weeks || weeks.length === 0) {
    container.innerHTML = `<p class="empty-state">Nenhuma semana gerada ainda.</p>`;
    return;
  }

  const peopleById = new Map((people ?? []).map((p) => [p.id, p]));

  container.innerHTML = "";
  for (const week of weeks) {
    container.appendChild(renderWeekAccordion(week, peopleById));
  }
}

function renderWeekAccordion(week, peopleById) {
  const details = document.createElement("details");
  details.className = "week-accordion";

  const summary = document.createElement("summary");
  summary.innerHTML = `
    <span class="week-accordion-label">${escapeHtml(week.label ?? week.start_date)}</span>
    ${week.is_current ? '<span class="tag-current">semana atual</span>' : ""}
  `;
  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = "week-accordion-body";
  body.innerHTML = `<p class="loading-hint">Carregando...</p>`;
  details.appendChild(body);

  let loaded = false;
  details.addEventListener("toggle", () => {
    if (!details.open || loaded) return;
    loaded = true;
    loadWeekDetail(week, peopleById, body);
  });

  return details;
}

async function loadWeekDetail(week, peopleById, body) {
  const [{ data: currentStates }, { data: baselineRows }, { data: events }] = await Promise.all([
    supabase.from("issue_current_state").select("*").eq("week_id", week.id),
    supabase.from("week_baseline_issues").select("*").eq("week_id", week.id),
    supabase
      .from("issue_events")
      .select("*")
      .eq("week_id", week.id)
      .neq("source", "week_start")
      .order("detected_at", { ascending: true }),
  ]);

  const currentStateByPerson = new Map();
  for (const row of currentStates ?? []) {
    if (!currentStateByPerson.has(row.person_id)) currentStateByPerson.set(row.person_id, []);
    currentStateByPerson.get(row.person_id).push(row);
  }

  const baselineByIssue = new Map();
  for (const row of baselineRows ?? []) baselineByIssue.set(row.issue_id, row);

  const changedEventByIssue = new Map();
  for (const ev of events ?? []) changedEventByIssue.set(ev.issue_id, ev);

  const personIds = Array.from(currentStateByPerson.keys()).sort((a, b) => {
    const orderA = peopleById.get(a)?.display_order ?? 0;
    const orderB = peopleById.get(b)?.display_order ?? 0;
    return orderA - orderB;
  });

  if (personIds.length === 0) {
    body.innerHTML = `<p class="empty-state">Nenhuma demanda registrada nessa semana.</p>`;
    return;
  }

  body.innerHTML = personIds
    .map((personId) => {
      const person = peopleById.get(personId);
      const { changed, unchanged } = groupIssuesForPerson(
        personId,
        currentStateByPerson,
        baselineByIssue,
        changedEventByIssue,
      );
      return `
        <article class="person-card">
          <header class="person-card-header">
            <a class="person-name" href="person.html?id=${personId}">${escapeHtml(person?.display_name ?? `Pessoa #${personId}`)}</a>
          </header>
          ${renderIssueSectionsHtml(changed, unchanged)}
        </article>
      `;
    })
    .join("");
}

load();

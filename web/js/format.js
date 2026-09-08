export const EVENT_LABELS = {
  added: "Adicionada",
  removed_from_sprint: "Removida da sprint",
  completed: "Concluída",
  status_changed: "Mudou status",
  reverted_to_original: "Voltou ao status original",
};

export function eventLabel(eventType) {
  return EVENT_LABELS[eventType] ?? eventType;
}

export function eventBadgeClass(eventType) {
  return `badge-${String(eventType).replace(/_/g, "-")}`;
}

// Redmine's priority field, in order: Baixa (green) -> Normal (green/yellow
// blend) -> Alta (yellow) -> Urgente (yellow/red blend) -> Imediata (red).
const PRIORITY_CLASS = {
  Baixa: "priority-baixa",
  Normal: "priority-normal",
  Alta: "priority-alta",
  Urgente: "priority-urgente",
  Imediata: "priority-imediata",
};

export function priorityBadgeClass(priorityName) {
  const key = PRIORITY_CLASS[priorityName];
  return key ? `badge-${key}` : "";
}

export function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

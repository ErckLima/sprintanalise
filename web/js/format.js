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

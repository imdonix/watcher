/** Relative time for compact UIs (e.g. "2h ago", "in 15m"). */
export function formatRelative(value: unknown): string {
  if (value == null || value === "") return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return "—";

  const ms = d.getTime() - Date.now();
  const abs = Math.abs(ms);
  const past = ms < 0;
  const mins = Math.round(abs / 60_000);

  if (mins < 1) return past ? "just now" : "now";
  if (mins < 60) return past ? `${mins}m ago` : `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return past ? `${hours}h ago` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return past ? `${days}d ago` : `in ${days}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDateTime(value: unknown): string {
  if (value == null || value === "") return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatEngine(slug?: string | null): string {
  if (!slug) return "";
  return slug.replace(/\.com$/, "").replace(/\.hu$/, "");
}

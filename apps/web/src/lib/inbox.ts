const LAST_SEEN_KEY = "watcher_last_seen_at";
const COUNT_KEY = "watcher_new_count";

/** Fired when the unread potential-product count changes. */
export const INBOX_EVENT = "watcher:inbox";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the inbox is best-effort */
  }
}

/** Timestamp of the last "mark all seen", or null on the first visit. */
export function readLastSeenAt(): number | null {
  const raw = safeGet(LAST_SEEN_KEY);
  if (!raw) return null;
  const ts = Number(raw);
  return Number.isFinite(ts) && ts > 0 ? ts : null;
}

export function writeLastSeenAt(ts: number): void {
  safeSet(LAST_SEEN_KEY, String(ts));
}

export function readNewCount(): number {
  const n = Number(safeGet(COUNT_KEY) ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Store + broadcast the unread count for the navigation badge. */
export function publishNewCount(count: number): void {
  const n = Math.max(0, Math.floor(count));
  safeSet(COUNT_KEY, String(n));
  window.dispatchEvent(new CustomEvent(INBOX_EVENT, { detail: n }));
}

export function subscribeNewCount(fn: (count: number) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<number>).detail;
    fn(Number.isFinite(detail) ? Math.max(0, Math.floor(detail)) : readNewCount());
  };
  window.addEventListener(INBOX_EVENT, handler);
  return () => window.removeEventListener(INBOX_EVENT, handler);
}

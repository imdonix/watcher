import type {
  EngineMeta,
  ItemView,
  ListingDetailResponse,
  StatusResponse,
} from "@watcher/shared";

const API_BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "/api";

function token(): string | null {
  return localStorage.getItem("watcher_token");
}

export function setToken(t: string | null) {
  if (t) localStorage.setItem("watcher_token", t);
  else localStorage.removeItem("watcher_token");
}

export function getToken(): string | null {
  return token();
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  const t = token();
  if (t) headers.set("Authorization", `Bearer ${t}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401) {
    setToken(null);
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  async login(apiToken: string) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: apiToken }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error || "Invalid API token");
    }
    return res.json() as Promise<{ ok: boolean; token: string }>;
  },

  me() {
    return request<{ ok: boolean; role: string }>("/auth/me");
  },

  engines() {
    return request<EngineMeta[]>("/engines");
  },

  routines() {
    return request<Record<string, unknown>[]>("/routines");
  },

  uploadRoutines(data: Record<string, unknown>[]) {
    return request<{ ok: boolean; count: number }>("/routines/upload", {
      method: "POST",
      body: JSON.stringify({ data }),
    });
  },

  items(limit = 100, status?: string) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (status) q.set("status", status);
    return request<ItemView[]>(`/items?${q}`);
  },

  listing(id: string) {
    return request<ListingDetailResponse>(`/items/${encodeURIComponent(id)}`);
  },

  setNotInterested(id: string, notInterested = true) {
    return request<ItemView>(`/items/${encodeURIComponent(id)}/not-interested`, {
      method: "POST",
      body: JSON.stringify({ interested: !notInterested }),
    });
  },

  scrap() {
    return request<{
      ok: boolean;
      started: boolean;
      alreadyRunning: boolean;
      message?: string;
    }>("/scrap", { method: "POST" });
  },

  notify() {
    return request<{ sent: number }>("/notify", { method: "POST" });
  },

  health() {
    return request<{
      ok: boolean;
      scraper: boolean;
      transports: { logger: boolean; push: boolean };
    }>("/health");
  },

  status() {
    return request<StatusResponse>("/status");
  },

  /** Public endpoint — no auth required */
  async pushVapidKey() {
    const res = await fetch(`${API_BASE}/push/vapid-public-key`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error || "Failed to load VAPID key");
    }
    return res.json() as Promise<{ publicKey: string }>;
  },

  pushSubscribe(sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    return request<{ ok: boolean }>("/push/subscribe", {
      method: "POST",
      body: JSON.stringify(sub),
    });
  },

  pushUnsubscribe(endpoint: string) {
    return request<{ ok: boolean }>("/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint }),
    });
  },

  pushStatus() {
    return request<{ configured: boolean; subscribers: number }>("/push/status");
  },

  runs() {
    return request<
      Array<{
        id: number;
        status: string;
        itemsFound: number | null;
        routinesTotal: number | null;
        startedAt: string;
        finishedAt: string | null;
        error: string | null;
      }>
    >("/runs");
  },
};

/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import type { RouteHandlerCallbackOptions } from "workbox-core/types.js";
import {
  addRoute,
  cleanupOutdatedCaches,
  matchPrecache,
  precache,
} from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";

declare let self: ServiceWorkerGlobalScope;

// Drop old Workbox/runtime caches from previous deploys
cleanupOutdatedCaches();

// Hashed build assets live here; each deploy gets a new SW revision.
// The precache is self-consistent: the HTML and the chunks it references are
// installed together, so the offline shell can never point at missing files.
precache(self.__WB_MANIFEST);

// Take over open tabs as soon as this SW activates
clientsClaim();

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      // Remove leftovers from much older SW versions. Never delete
      // "workbox-precache-*": that is the cache this worker just populated.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("pages") || k.startsWith("assets"))
          .map((k) => caches.delete(k)),
      );
    })(),
  );
});

// NOTE: no self.skipWaiting() on install. Activating a new worker mid-session
// swaps HTML/chunks under the running page (and forces reloads); on iOS this
// can leave the PWA on a blank white/black screen, especially around a back
// navigation. The page sends SKIP_WAITING when the user applies an update.

/**
 * Serve the precached app shell for navigations.
 *
 * Cache-first is deliberate: an installed PWA must paint immediately, even
 * when iOS resumes it with a dead network stack. The precache is
 * self-consistent (HTML + its hashed chunks share one revision), so it can
 * never pair an old document with chunks that no longer exist. Fresh deploys
 * arrive through the in-app "Update available" prompt, which activates the
 * next worker and reloads once.
 *
 * The last-resort synthetic page is what guarantees we never answer a
 * navigation with an empty/blank document when the precache was evicted
 * (iOS storage pressure) and the network is down.
 */
const NAVIGATION_TIMEOUT_MS = 3500;

const RECOVERY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f7f8fa">
<title>Watcher</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: #f7f8fa;
    color: #111827;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
  }
  main { max-width: 22rem; text-align: center; }
  h1 { margin: 0 0 8px; font-size: 18px; letter-spacing: -0.01em; }
  p { margin: 0 0 20px; font-size: 14px; line-height: 1.55; color: #6b7280; }
  button {
    appearance: none;
    border: 0;
    border-radius: 999px;
    background: #3b5bdb;
    color: #fff;
    font: inherit;
    font-weight: 600;
    padding: 11px 22px;
  }
  button:active { opacity: 0.85; }
  @media (prefers-color-scheme: dark) {
    body { background: #0b0d12; color: #f3f4f6; }
    p { color: #9ca3af; }
  }
</style>
</head>
<body>
  <main>
    <h1>Watcher can't load right now</h1>
    <p>The network is unavailable and the saved copy of the app could not be opened. Check your connection and try again.</p>
    <button type="button" onclick="location.reload()">Try again</button>
  </main>
  <script>
    // Reload as soon as connectivity returns, so the dead end is temporary.
    window.addEventListener("online", function () { location.reload(); });
    setTimeout(function () {
      fetch(location.href, { method: "HEAD", cache: "no-store" })
        .then(function (res) { if (res && res.ok) location.reload(); })
        .catch(function () {});
    }, 4000);
  </script>
</body>
</html>`;

function recoveryResponse(): Response {
  return new Response(RECOVERY_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function cachedShell(): Promise<Response | undefined> {
  try {
    return await matchPrecache("/index.html");
  } catch {
    return undefined;
  }
}

async function fetchWithTimeout(request: Request): Promise<Response | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
  try {
    return await fetch(request, { signal: controller.signal });
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A 200 from the network is not necessarily our app: captive portals and
 * misconfigured proxies sometimes answer with their own HTML page. Serving
 * that would leave the PWA on a blank/foreign document, so only accept a
 * response that actually contains the app root.
 */
async function isAppShell(response: Response): Promise<boolean> {
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) return false;
  try {
    const html = await response.clone().text();
    return html.includes('id="root"') || html.includes("id='root'");
  } catch {
    return false;
  }
}

async function navigationHandler(
  options: RouteHandlerCallbackOptions,
): Promise<Response> {
  // 1. The saved shell is always the fastest and safest answer.
  const shell = await cachedShell();
  if (shell) return shell;

  // 2. No shell (first run, or iOS evicted the cache): try the network.
  if (self.navigator.onLine !== false) {
    const response = await fetchWithTimeout(options.request);
    if (response?.ok && (await isAppShell(response))) return response;
  }

  // 3. Never hand the browser an empty document. Show a tiny recovery page
  //    that retries by itself once the connection is back.
  return recoveryResponse();
}

// Register the navigation route BEFORE the precache route so *all* navigations
// — including "/" and "/index.html" — go through the resilient handler above.
registerRoute(
  new NavigationRoute(navigationHandler, {
    // Don't handle API or SW itself
    denylist: [/^\/api\//, /\/sw\.js$/, /\/workbox-.*\.js$/],
  }),
);

// PrecacheRoute for hashed assets (HTML navigations are handled above).
addRoute();

interface PushData {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  count?: number;
}

self.addEventListener("push", (event: PushEvent) => {
  let data: PushData = {
    body: "New listing available",
    url: "/listings",
  };

  try {
    if (event.data) {
      const text = event.data.text();
      try {
        data = { ...data, ...JSON.parse(text) };
      } catch {
        data.body = text;
      }
    }
  } catch {
    /* defaults */
  }

  // Prefer body as the only visible text (no branded "Watcher" title).
  // Notification API requires a title — use the message there and omit body.
  const message = (data.body || data.title || "New listing available").trim();
  const options = {
    body: "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || "watcher-deals",
    data: { url: data.url || "/listings" },
    renotify: true,
    requireInteraction: false,
  } satisfies NotificationOptions & { renotify?: boolean };

  event.waitUntil(self.registration.showNotification(message, options));
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url || "/listings";
  const target = new URL(url, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            await (client as WindowClient).navigate(target);
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// Allow the page to force an update (user taps "Reload" in the update toast).
// Workbox's `messageSkipWaiting()` sends {type: "SKIP_WAITING"}.
self.addEventListener("message", (event) => {
  const data = event.data as unknown;
  const isSkipWaiting =
    data === "SKIP_WAITING" ||
    (typeof data === "object" &&
      data !== null &&
      (data as { type?: unknown }).type === "SKIP_WAITING");
  if (isSkipWaiting) void self.skipWaiting();
});

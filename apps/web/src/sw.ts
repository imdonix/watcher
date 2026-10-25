/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import type { RouteHandlerCallbackOptions } from "workbox-core/types.js";
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";

declare let self: ServiceWorkerGlobalScope;

// Drop old Workbox/runtime caches from previous deploys
cleanupOutdatedCaches();

// Hashed build assets live here; each deploy gets a new SW revision.
// The precache is self-consistent: the HTML and the chunks it references are
// installed together, so the offline shell can never point at missing files.
precacheAndRoute(self.__WB_MANIFEST);

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

// SPA navigations: always try the network first so a fresh deploy is picked up
// immediately. Serving the precached index.html first (the old behaviour) can
// hand the browser an old document that references chunks which no longer
// exist after a deploy — a blank screen. Precache is only the offline fallback.
const offlineShell = createHandlerBoundToURL("/index.html");

const NAVIGATION_TIMEOUT_MS = 4000;

async function navigationHandler(options: RouteHandlerCallbackOptions) {
  const { request } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response && response.ok) return response;
  } catch {
    /* offline, aborted or flaky network — use the precached shell below */
  } finally {
    clearTimeout(timer);
  }

  return offlineShell(options);
}

registerRoute(
  new NavigationRoute(navigationHandler, {
    // Don't handle API or SW itself
    denylist: [/^\/api\//, /\/sw\.js$/, /\/workbox-.*\.js$/],
  }),
);

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

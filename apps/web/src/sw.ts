/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";

declare let self: ServiceWorkerGlobalScope;

// Drop old Workbox/runtime caches from previous deploys
cleanupOutdatedCaches();

// Hashed build assets live here; each deploy gets a new SW revision
precacheAndRoute(self.__WB_MANIFEST);

// Take over open tabs as soon as this SW activates
clientsClaim();

self.addEventListener("install", (event) => {
  // Activate immediately — do not wait for all tabs to close
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      // Remove any non-precache caches left by older SW versions
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("pages") || k.startsWith("assets") || k.startsWith("workbox-"))
          .map((k) => caches.delete(k)),
      );
    })(),
  );
});

// SPA navigations: always try network first for HTML, fall back to precached index
const htmlHandler = createHandlerBoundToURL("/index.html");
registerRoute(
  new NavigationRoute(htmlHandler, {
    // Don't handle API or SW itself
    denylist: [/^\/api\//, /\/sw\.js$/, /\/workbox-.*\.js$/],
  }),
);

// Do NOT CacheFirst JS/CSS — precache already versions them.
// Extra CacheFirst routes were serving stale bundles forever.

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

// Allow the page to force an update check
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

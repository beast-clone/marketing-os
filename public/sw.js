// Marketing OS app (app/manifest.ts). Deliberately does almost nothing: pages and data
// always come live from the network, so the app never shows stale numbers. The only
// thing kept is a small offline page, shown when a page can't load with no connection.
const OFFLINE = "/offline.html";
const ICON = "/app-icon-192.png"; // the offline page shows it
const CACHE = "gc-offline-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, ICON])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  if (new URL(e.request.url).pathname === ICON) { e.respondWith(fetch(e.request).catch(() => caches.match(ICON))); return; }
  if (e.request.mode !== "navigate") return; // everything else goes straight to the network
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});

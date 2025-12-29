/* sw.js — ClockIn v2.0.0 */
"use strict";

const CACHE_NAME = "clockin-v2.0.0";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE_NAME) ? caches.delete(k) : Promise.resolve()));
    self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Navegación: sirve index offline
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match("./index.html");
      try {
        const fresh = await fetch(req);
        cache.put("./index.html", fresh.clone());
        return fresh;
      } catch {
        return cached || new Response("Offline", { status: 200, headers: { "Content-Type":"text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  // Assets: cache-first + refresh
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) {
      event.waitUntil(fetch(req).then(r => cache.put(req, r.clone())).catch(() => {}));
      return cached;
    }
    try {
      const fresh = await fetch(req);
      cache.put(req, fresh.clone());
      return fresh;
    } catch {
      return cached || new Response("", { status: 504 });
    }
  })());
});

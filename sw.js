/* sw.js — ClockIn v2.0.1 */
(() => {
  "use strict";

  const VERSION = "2.0.1";
  const CACHE_NAME = `clockin-cache-${VERSION}`;

  // OJO: están con query-string para forzar updates aunque el navegador sea pesado con caché
  const ASSETS = [
    "./",
    "./index.html?v=2.0.1",
    "./styles.css?v=2.0.1",
    "./app.js?v=2.0.1",
    "./manifest.webmanifest?v=2.0.1",
    "./manifest.webmanifest",
    "./assets/icons/favicon-32.png",
    "./assets/icons/apple-touch-icon-152.png",
    "./assets/icons/apple-touch-icon-167.png",
    "./assets/icons/apple-touch-icon-180.png",
    "./assets/icons/icon-192.png",
    "./assets/icons/icon-512.png",
    "./assets/icons/icon-192-maskable.png",
    "./assets/icons/icon-512-maskable.png"
  ];

  self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(ASSETS);
      await self.skipWaiting();
    })());
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
      await self.clients.claim();
    })());
  });

  self.addEventListener("message", (event) => {
    if (!event.data) return;
    if (event.data.type === "SKIP_WAITING") self.skipWaiting();
  });

  self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;

    const url = new URL(req.url);

    // Solo mismo origen
    if (url.origin !== self.location.origin) return;

    // Navegación: intenta red y cae al index cacheado
    if (req.mode === "navigate") {
      event.respondWith((async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone()).catch(() => {});
          return fresh;
        } catch (_) {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match("./index.html?v=2.0.1")) || (await cache.match("./")) || Response.error();
        }
      })());
      return;
    }

    // Estáticos: cache-first + revalidate
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) {
        fetch(req).then((res) => cache.put(req, res.clone()).catch(() => {})).catch(() => {});
        return cached;
      }
      try {
        const res = await fetch(req);
        cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch (_) {
        return cached || Response.error();
      }
    })());
  });
})();

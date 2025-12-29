/* sw.js — ClockIn v1.0.0 (APP SHELL + SWR + SAFE UPDATE) */
(() => {
  "use strict";

  const VERSION = "1.0.0";
  const CACHE = `clockin-${VERSION}`;
  const CORE = [
    "./",
    "./index.html",
    "./styles.css",
    "./app.js",
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

  self.addEventListener("install", (e) => {
    e.waitUntil((async () => {
      const c = await caches.open(CACHE);
      await c.addAll(CORE);
      // No skipWaiting aquí: evitamos loops raros (iOS). Se activa vía postMessage.
    })());
  });

  self.addEventListener("activate", (e) => {
    e.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : null)));
      await self.clients.claim();
    })());
  });

  self.addEventListener("message", (e) => {
    if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
  });

  self.addEventListener("fetch", (e) => {
    const req = e.request;
    if (req.method !== "GET") return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    // Navegación: network-first con fallback a cache (offline)
    if (req.mode === "navigate") {
      e.respondWith((async () => {
        try {
          const fresh = await fetch(req);
          const c = await caches.open(CACHE);
          c.put("./index.html", fresh.clone()).catch(() => {});
          return fresh;
        } catch (_) {
          const c = await caches.open(CACHE);
          return (await c.match("./index.html")) || (await c.match("./")) || Response.error();
        }
      })());
      return;
    }

    // Stale-while-revalidate para assets
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const cached = await c.match(req);

      const net = fetch(req).then(res => {
        c.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);

      return cached || (await net) || Response.error();
    })());
  });
})();

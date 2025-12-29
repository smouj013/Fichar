/*
  sw.js — PWA offline
  Smouj013
*/
const CACHE = "fichaje-cache-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : Promise.resolve())));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);

    const isHTML = req.headers.get("accept")?.includes("text/html");
    if (isHTML) {
      try {
        const fresh = await fetch(req);
        cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        return cached || cache.match("./index.html");
      }
    }

    if (cached) return cached;

    try {
      const fresh = await fetch(req);
      cache.put(req, fresh.clone()).catch(() => {});
      return fresh;
    } catch {
      return cached || Response.error();
    }
  })());
});

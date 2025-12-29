/* sw.js — ClockIn v2.0.3 (AUTO-UPDATE estable + OFFLINE)
   - Precaching tolerante (no rompe install si falta un archivo)
   - Navegación: network-first con timeout + fallback cache (ignoreSearch)
   - Estáticos: cache-first + refresh background (stale refresh)
   - Runtime: stale-while-revalidate
   - Cleanup de caches antiguos + clients.claim
*/

(() => {
  "use strict";

  const VERSION = "2.0.3";
  const CACHE = `clockin-${VERSION}`;

  // Precaching (misma ruta/origen)
  const CORE = [
    "./",
    "./index.html",
    "./styles.css",
    "./app.js",
    "./sw.js",
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

  function isOkResponse(res) {
    return !!res && (res.ok || res.type === "opaque");
  }

  async function safePrecache(cache) {
    const reqs = CORE.map((u) => new Request(u, { cache: "reload" }));
    await Promise.allSettled(
      reqs.map(async (req) => {
        try {
          const res = await fetch(req);
          if (!isOkResponse(res)) return;
          await cache.put(req, res.clone());
        } catch (_) {}
      })
    );
  }

  self.addEventListener("install", (e) => {
    e.waitUntil((async () => {
      const c = await caches.open(CACHE);
      await safePrecache(c);
      // No skipWaiting aquí: reduce loops raros en algunos navegadores.
    })());
  });

  self.addEventListener("activate", (e) => {
    e.waitUntil((async () => {
      // Navigation Preload (si existe)
      try {
        if (self.registration && self.registration.navigationPreload) {
          await self.registration.navigationPreload.enable();
        }
      } catch (_) {}

      // Limpia caches anteriores
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)));

      await self.clients.claim();
    })());
  });

  self.addEventListener("message", (e) => {
    if (e.data && e.data.type === "SKIP_WAITING") {
      try { self.skipWaiting(); } catch (_) {}
    }
  });

  async function fetchWithTimeout(req, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(req, { signal: ctl.signal });
      clearTimeout(t);
      return res;
    } catch (err) {
      clearTimeout(t);
      throw err;
    }
  }

  function isStaticAsset(url) {
    const p = url.pathname;
    return (
      p.endsWith(".js") ||
      p.endsWith(".css") ||
      p.endsWith(".webmanifest") ||
      p.endsWith(".png") ||
      p.endsWith(".svg") ||
      p.endsWith(".ico") ||
      p.endsWith(".jpg") ||
      p.endsWith(".jpeg") ||
      p.endsWith(".webp") ||
      p.endsWith(".woff") ||
      p.endsWith(".woff2")
    );
  }

  self.addEventListener("fetch", (e) => {
    const req = e.request;
    if (req.method !== "GET") return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    // ── Navegación: network-first + fallback cache
    if (req.mode === "navigate") {
      e.respondWith((async () => {
        const c = await caches.open(CACHE);

        // Usa navigation preload si está disponible
        const preload = (async () => {
          try { return await e.preloadResponse; } catch (_) { return null; }
        })();

        try {
          const pre = await preload;
          if (pre && isOkResponse(pre)) {
            // Cachea index como fallback offline
            try {
              await c.put(new Request("./index.html", { cache: "reload" }), pre.clone());
            } catch (_) {}
            return pre;
          }

          const fresh = await fetchWithTimeout(req, 4500);
          if (isOkResponse(fresh)) {
            try {
              await c.put(new Request("./index.html", { cache: "reload" }), fresh.clone());
            } catch (_) {}
          }
          return fresh;
        } catch (_) {
          return (
            (await c.match("./index.html", { ignoreSearch: true })) ||
            (await c.match("./", { ignoreSearch: true })) ||
            new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
          );
        }
      })());
      return;
    }

    // ── Estáticos: cache-first + refresh background
    if (isStaticAsset(url)) {
      e.respondWith((async () => {
        const c = await caches.open(CACHE);
        const cached = await c.match(req, { ignoreSearch: true });

        const net = fetch(req).then(async (res) => {
          if (isOkResponse(res)) {
            try { await c.put(req, res.clone()); } catch (_) {}
          }
          return res;
        }).catch(() => null);

        return cached || (await net) || new Response("", { status: 504 });
      })());
      return;
    }

    // ── Runtime: stale-while-revalidate
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const cached = await c.match(req);

      const net = fetch(req).then(async (res) => {
        if (isOkResponse(res)) {
          try { await c.put(req, res.clone()); } catch (_) {}
        }
        return res;
      }).catch(() => null);

      return cached || (await net) || new Response("", { status: 504 });
    })());
  });

})();

/* sw.js — ClockIn v2.0.4 (AUTO-UPDATE estable + OFFLINE + CACHE-BUST FIX)
   ✅ Fix crítico: NO ignoreSearch en estáticos (css/js) para que ?v= funcione
   ✅ Precache separado de runtime
   ✅ Navegación: network-first + timeout + fallback precache
   ✅ Estáticos: cache-first + revalidate (sin romper updates)
   ✅ Runtime: stale-while-revalidate
*/

(() => {
  "use strict";

  const VERSION = "2.0.4";

  // Separar caches = más estable
  const CACHE_PRE = `clockin-precache-${VERSION}`;
  const CACHE_RUN = `clockin-runtime-${VERSION}`;

  // Solo limpiamos lo nuestro
  const PREFIXES = ["clockin-precache-", "clockin-runtime-", "clockin-"];

  // Precaching (misma ruta/origen)
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

  function isOkResponse(res) {
    return !!res && (res.ok || res.type === "opaque");
  }

  function sameOrigin(url) {
    try { return url.origin === self.location.origin; }
    catch (_) { return false; }
  }

  function isStaticAsset(url) {
    const p = url.pathname || "";
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

  async function safePrecache(cache) {
    const reqs = CORE.map((u) => new Request(u, { cache: "reload" }));
    await Promise.allSettled(reqs.map(async (req) => {
      try {
        const res = await fetch(req);
        if (!isOkResponse(res)) return;
        await cache.put(req, res.clone());
      } catch (_) {}
    }));
  }

  self.addEventListener("install", (e) => {
    e.waitUntil((async () => {
      const c = await caches.open(CACHE_PRE);
      await safePrecache(c);
      // No skipWaiting aquí: evita loops raros en algunos navegadores.
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

      // Limpia caches antiguos SOLO de ClockIn
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => {
        const isOurs = PREFIXES.some(p => k.startsWith(p));
        const keep = (k === CACHE_PRE || k === CACHE_RUN);
        return (isOurs && !keep) ? caches.delete(k) : null;
      }));

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

  self.addEventListener("fetch", (e) => {
    const req = e.request;
    if (req.method !== "GET") return;

    const url = new URL(req.url);
    if (!sameOrigin(url)) return;

    // ─────────────────────────
    // Navegación: network-first + fallback precache
    // ─────────────────────────
    if (req.mode === "navigate") {
      e.respondWith((async () => {
        const preCache = await caches.open(CACHE_PRE);

        // navigation preload (si existe)
        const preload = (async () => {
          try { return await e.preloadResponse; } catch (_) { return null; }
        })();

        try {
          const pre = await preload;
          if (pre && isOkResponse(pre)) {
            try { await preCache.put("./index.html", pre.clone()); } catch (_) {}
            return pre;
          }

          const fresh = await fetchWithTimeout(req, 4500);
          if (isOkResponse(fresh)) {
            try { await preCache.put("./index.html", fresh.clone()); } catch (_) {}
          }
          return fresh;
        } catch (_) {
          return (
            (await preCache.match("./index.html")) ||
            (await preCache.match("./")) ||
            new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
          );
        }
      })());
      return;
    }

    // ─────────────────────────
    // Estáticos: cache-first + revalidate
    // ✅ SIN ignoreSearch aquí (fix del CSS/JS actualizado)
    // ─────────────────────────
    if (isStaticAsset(url)) {
      e.respondWith((async () => {
        const preCache = await caches.open(CACHE_PRE);

        // OJO: match EXACTO (incluye ?v= si existe)
        const cached = await preCache.match(req);

        const netPromise = fetch(req).then(async (res) => {
          if (isOkResponse(res)) {
            try { await preCache.put(req, res.clone()); } catch (_) {}
          }
          return res;
        }).catch(() => null);

        // cache-first
        return cached || (await netPromise) || new Response("", { status: 504 });
      })());
      return;
    }

    // ─────────────────────────
    // Runtime: stale-while-revalidate
    // ─────────────────────────
    e.respondWith((async () => {
      const runCache = await caches.open(CACHE_RUN);
      const cached = await runCache.match(req);

      const netPromise = fetch(req).then(async (res) => {
        if (isOkResponse(res)) {
          try { await runCache.put(req, res.clone()); } catch (_) {}
        }
        return res;
      }).catch(() => null);

      return cached || (await netPromise) || new Response("", { status: 504 });
    })());
  });

})();

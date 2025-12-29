/* sw.js — ClockIn v2.0.0 (AUTO-UPDATE estable + offline) */
(() => {
  "use strict";

  const VERSION = "2.0.0";
  const CACHE = `clockin-${VERSION}`;

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

  async function safePrecache(cache){
    // No dejes que un archivo faltante rompa el install.
    // (Muy típico cuando cambian iconos o rutas)
    const reqs = CORE.map(u => new Request(u, { cache: "reload" }));
    const results = await Promise.allSettled(
      reqs.map(async (req) => {
        const res = await fetch(req);
        if (!res || !res.ok) return;
        await cache.put(req, res.clone());
      })
    );
    // results se ignora a propósito (silent)
    return results;
  }

  self.addEventListener("install", (e) => {
    e.waitUntil((async () => {
      const c = await caches.open(CACHE);
      await safePrecache(c);
      // No hacemos skipWaiting aquí (evita loops raros en iOS)
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

  async function fetchWithTimeout(req, ms){
    const ctl = new AbortController();
    const t = setTimeout(()=>ctl.abort(), ms);
    try{
      const res = await fetch(req, { signal: ctl.signal });
      clearTimeout(t);
      return res;
    }catch(err){
      clearTimeout(t);
      throw err;
    }
  }

  self.addEventListener("fetch", (e) => {
    const req = e.request;
    if (req.method !== "GET") return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    // Navegación: network-first, fallback cache (ignoreSearch)
    if (req.mode === "navigate") {
      e.respondWith((async () => {
        const c = await caches.open(CACHE);
        try {
          const fresh = await fetchWithTimeout(req, 4500);
          // guarda index para offline
          c.put("./index.html", fresh.clone()).catch(()=>{});
          return fresh;
        } catch (_) {
          return (await c.match("./index.html", { ignoreSearch: true }))
            || (await c.match("./", { ignoreSearch: true }))
            || Response.error();
        }
      })());
      return;
    }

    // Estáticos: cache-first + refresh en background
    const isStatic = (
      url.pathname.endsWith(".js") ||
      url.pathname.endsWith(".css") ||
      url.pathname.endsWith(".webmanifest") ||
      url.pathname.endsWith(".png") ||
      url.pathname.endsWith(".svg") ||
      url.pathname.endsWith(".ico")
    );

    if (isStatic) {
      e.respondWith((async () => {
        const c = await caches.open(CACHE);
        const cached = await c.match(req, { ignoreSearch: true });

        const net = fetch(req).then(res => {
          if (res && res.ok) c.put(req, res.clone()).catch(()=>{});
          return res;
        }).catch(()=>null);

        return cached || (await net) || Response.error();
      })());
      return;
    }

    // Default: stale-while-revalidate
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const cached = await c.match(req);

      const net = fetch(req).then(res => {
        if (res && res.ok) c.put(req, res.clone()).catch(()=>{});
        return res;
      }).catch(()=>null);

      return cached || (await net) || Response.error();
    })());
  });

})();

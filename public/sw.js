// L.L Bicycle Center service worker: precache the app shell, then serve cache-first so the app opens offline.
const CACHE = "llbc-shell-v5";

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    let list = ["./", "./index.html", "./manifest.webmanifest", "./logo.svg"];
    try {
      const res = await fetch("./precache.json", { cache: "no-store" });
      if (res.ok) list = await res.json();
    } catch (_) { /* dev server or offline: fall back to the minimal shell */ }
    await Promise.all(list.map(url => cache.add(url).catch(() => null)));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("llbc-shell-") && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase/Google traffic is never cached here
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === "navigate") {
      try { const fresh = await fetch(req); cache.put("./index.html", fresh.clone()); return fresh; }
      catch (_) { return (await cache.match("./index.html")) || (await cache.match("./")) || Response.error(); }
    }
    const cached = await cache.match(req);
    if (cached) { fetch(req).then(r => r.ok && cache.put(req, r)).catch(() => null); return cached; }
    try { const fresh = await fetch(req); if (fresh.ok) cache.put(req, fresh.clone()); return fresh; }
    catch (_) { return Response.error(); }
  })());
});

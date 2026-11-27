// Network first, falls back to the saved copy so the app opens offline.
const C = "ll-ledger-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(clients.claim()));
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || !/^https?:$/.test(u.protocol)) return;
  if (u.hostname.endsWith("googleapis.com")) return; // Firestore and sign-in handle their own offline mode
  e.respondWith(
    fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(C).then(x => x.put(r, c)); } return res; })
      .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match("./index.html")))
  );
});

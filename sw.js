/* Vigie Patrimoine — fonctionnement hors ligne : l'appli (pas les données GitHub) est gardée en cache. */
const V = "vigie-app-v11";
const COQUILLE = ["./", "index.html", "stockage.js", "manifest.json", "icon.svg", "icon-192.png",
  "https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => Promise.all(COQUILLE.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.hostname === "api.github.com") return; // données : jamais en cache ici
  // réseau d'abord (mises à jour de l'appli), cache si hors ligne
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});

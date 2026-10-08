/* Cadência — service worker: guarda o app no aparelho e abre sem internet. */
const CACHE = "cadencia-v5";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png",
  "./cloud.js", "./ux.js", "./firebase-config.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Só os arquivos do próprio app passam por aqui. Login do Google e Firestore vão direto para a rede.
// Estratégia: responde do cache na hora e atualiza a cópia em segundo plano (vale na próxima abertura).
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/__/")) return;
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(e.request, { ignoreSearch: true }).then((hit) => {
        const net = fetch(e.request).then((resp) => {
          if (resp.ok) cache.put(e.request, resp.clone()).catch(() => {});
          return resp;
        });
        if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
        return net.catch(() => cache.match("./index.html"));
      })
    )
  );
});

// Service worker — "What Is This?"
// • app shell : cache-first (fonctionne 100% hors ligne)
// • lib Transformers.js / runtime ONNX (CDN jsDelivr) : stale-while-revalidate
// • poids du modèle (huggingface.co) : NON interceptés — Transformers.js gère
//   son propre cache (Cache API « transformers-cache »), pour éviter de
//   dupliquer ~500 Mo et de saturer le quota de stockage.

const VERSION = "v1-2026-05-16";
const CACHE = `what-is-this-${VERSION}`;

const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./worker.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Laisser passer les poids du modèle : gérés par Transformers.js.
  if (
    url.hostname.endsWith("huggingface.co") ||
    url.hostname.endsWith("hf.co") ||
    url.hostname.includes("cdn-lfs")
  ) {
    return;
  }

  // App shell (même origine) : cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }).catch(() => caches.match("./index.html")),
      ),
    );
    return;
  }

  // CDN jsDelivr (lib Transformers.js + wasm ONNX) : stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

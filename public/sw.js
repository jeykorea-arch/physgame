const CACHE_NAME = "physgame-three-lessons-v6-science-audit";
const scopedAsset = (path) => new URL(path, self.registration.scope).toString();
const CORE_ASSETS = [
  "data/quiz_bank_v1.json",
  "data/marker_manifest.json",
  "assets/targets.mind",
  "vendor/aframe-v1.5.0.min.js",
  "vendor/mindar-image-aframe.prod.js",
  "manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS.map(scopedAsset))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  const relativePath = new URL(event.request.url).href.slice(self.registration.scope.length);
  if (relativePath.startsWith("data/")) {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }
  if (relativePath.startsWith("assets/") || relativePath.startsWith("vendor/")) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
  }
});

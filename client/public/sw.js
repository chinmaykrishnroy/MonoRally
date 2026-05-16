const CACHE = "monorally-v19";
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/src/main.js",
  "/src/core/shared.js",
  "/src/game/local-game.js",
  "/src/network/protocol.js",
  "/src/network/socket.js",
  "/src/platform/session.js",
  "/src/rendering/renderer.js",
  "/src/ui/audio.js",
  "/src/ui/dom.js",
  "/src/ui/settings-ui.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const freshRequest = new Request(event.request, { cache: "no-store" });
  event.respondWith(fetch(freshRequest).catch(() => caches.match(event.request).then((hit) => hit || caches.match("/"))));
});

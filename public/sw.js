const CACHE_NAME = "ams-start-shell-v1";
const SHELL_ASSETS = ["/", "/offline/", "/ams-start-icon.svg", "/ams-favicon.svg"];
const PRIVATE_PATH_PREFIXES = [
  "/api/",
  "/admin/",
  "/dashboard/",
  "/notifications/",
  "/login/",
  "/auth/",
];

function isPrivateRequest(url) {
  return PRIVATE_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivateRequest(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline/")),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/ams-start-icon.svg" || url.pathname === "/ams-favicon.svg") {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached ??
        fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        }),
      ),
    );
  }
});

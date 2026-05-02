/* global self, caches */

// Legacy PWA cleanup. The old Workbox service worker cached HTML and
// public Sanity responses; keep this file for one deploy cycle so
// existing browsers replace it, clear old caches, and unregister.
self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (name) {
              return (
                name.indexOf("workbox") !== -1 ||
                name.indexOf("google-fonts") !== -1 ||
                name.indexOf("sanity-api") !== -1 ||
                name.indexOf("precache") !== -1
              );
            })
            .map(function (name) {
              return caches.delete(name);
            }),
        );
      })
      .then(function () {
        return self.registration.unregister();
      }),
  );
});

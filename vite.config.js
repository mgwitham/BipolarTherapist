import { defineConfig } from "vite";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { VitePWA } from "vite-plugin-pwa";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  appType: "mpa",
  server: {
    host: "0.0.0.0",
    port: 5200,
    // Serve therapist.html for /therapists/:slug paths in dev (prod uses the SSR function)
    fs: { strict: false },
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.png"],
      manifest: {
        name: "BipolarTherapyHub",
        short_name: "BTHub",
        description: "Find bipolar-informed therapists in California.",
        theme_color: "#1a7a8f",
        background_color: "#f7fbfc",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com/,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-stylesheets",
              expiration: { maxAgeSeconds: 31536000 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com/,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxAgeSeconds: 31536000 },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.apicdn\.sanity\.io/,
            handler: "NetworkFirst",
            options: {
              cacheName: "sanity-api",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 60, maxAgeSeconds: 86400 },
            },
          },
        ],
      },
    }),
    {
      name: "therapist-profile-dev-fallback",
      configureServer(server) {
        server.middlewares.use(function (req, res, next) {
          if (req.url && /^\/therapists\/[^/]+\/?(\?.*)?$/.test(req.url)) {
            req.url = "/therapist.html";
          }
          next();
        });
      },
    },
  ],
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
  build: {
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        index: resolve(rootDir, "index.html"),
        match: resolve(rootDir, "match.html"),
        directory: resolve(rootDir, "directory.html"),
        therapist: resolve(rootDir, "therapist.html"),
        signup: resolve(rootDir, "signup.html"),
        claim: resolve(rootDir, "claim.html"),
        admin: resolve(rootDir, "admin.html"),
        portal: resolve(rootDir, "portal.html"),
        pricing: resolve(rootDir, "pricing.html"),
        confirmClaim: resolve(rootDir, "confirm-claim.html"),
        remove: resolve(rootDir, "remove.html"),
        recover: resolve(rootDir, "recover.html"),
        privacy: resolve(rootDir, "privacy.html"),
        terms: resolve(rootDir, "terms.html"),
        404: resolve(rootDir, "404.html"),
      },
    },
  },
});

import { defineConfig } from "vite";
import { resolve } from "path";
import { fileURLToPath } from "url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  appType: "mpa",
  server: {
    host: "127.0.0.1",
    port: 5200,
    proxy: {
      "/api/review": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
    // Serve therapist.html for /therapists/:slug paths in dev (prod uses the SSR function)
    fs: { strict: true },
  },
  plugins: [
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
        about: resolve(rootDir, "about.html"),
        outreach: resolve(rootDir, "outreach.html"),
        404: resolve(rootDir, "404.html"),
      },
    },
  },
});

import { defineConfig } from "vite";
import { resolve } from "path";
import { fileURLToPath } from "url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(rootDir, "index.html"),
        match: resolve(rootDir, "match.html"),
        directory: resolve(rootDir, "directory.html"),
        therapist: resolve(rootDir, "therapist.html"),
        signup: resolve(rootDir, "signup.html"),
        admin: resolve(rootDir, "admin.html"),
        portal: resolve(rootDir, "portal.html"),
        pricing: resolve(rootDir, "pricing.html"),
      },
    },
  },
});

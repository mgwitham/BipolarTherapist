import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173
  },
  preview: {
    host: "127.0.0.1",
    port: 4173
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        directory: resolve(__dirname, "directory.html"),
        therapist: resolve(__dirname, "therapist.html"),
        signup: resolve(__dirname, "signup.html"),
        admin: resolve(__dirname, "admin.html")
      }
    }
  }
});

import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const diagnosticsOrigin =
  process.env.LUCENT_OBSERVABILITY_ORIGIN ?? "http://127.0.0.1:10637";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api/messages": diagnosticsOrigin,
      "/api/state": diagnosticsOrigin,
      "/api/traces": diagnosticsOrigin,
      "/events": diagnosticsOrigin,
      "/health": diagnosticsOrigin,
      "/trace-events": diagnosticsOrigin,
    },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Dashboard dev server proxies API + auth + webhooks to the monolith.
    proxy: {
      "/api": "http://localhost:3000",
      "/auth": "http://localhost:3000",
    },
  },
  build: { outDir: "dist" },
});

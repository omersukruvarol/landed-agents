import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // `landed open --port 47831` (or `pnpm dev:server`) serves the API during UI development.
    proxy: { "/v1": "http://127.0.0.1:47831" },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});

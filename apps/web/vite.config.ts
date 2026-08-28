import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: Boolean(process.env.WEB_PORT),
    proxy: {
      "/api": process.env.API_PROXY_TARGET ?? "http://localhost:4000",
      "/health": process.env.API_PROXY_TARGET ?? "http://localhost:4000"
    }
  }
});

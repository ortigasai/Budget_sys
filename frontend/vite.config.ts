import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on the LAN, not just localhost, so colleagues on the same network can reach it
    port: 5173,
    proxy: {
      // /api2 must come before /api - Vite matches proxy keys by prefix in
      // declaration order, and "/api2/..." also starts with "/api".
      "/api2": {
        target: "http://localhost:8010",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api2/, ""),
      },
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/uploads": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});

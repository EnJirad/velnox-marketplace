import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@velnox/i18n": path.resolve(__dirname, "../../packages/i18n/src"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: { outDir: "dist" },
  server: { host: true, port: 5176, hmr: false },
});

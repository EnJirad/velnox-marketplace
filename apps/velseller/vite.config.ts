import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@velnox/types": path.resolve(__dirname, "../../packages/types/src"),
      "@velnox/api": path.resolve(__dirname, "../../packages/api/src"),
      "@velnox/api-client": path.resolve(__dirname, "../../packages/api-client/src"),
      "@velnox/hooks": path.resolve(__dirname, "../../packages/hooks/src"),
      "@velnox/i18n": path.resolve(__dirname, "../../packages/i18n/src"),
      "@velnox/utils": path.resolve(__dirname, "../../packages/utils/src"),
      "@velnox/ui": path.resolve(__dirname, "../../packages/ui/src"),
      "@velnox/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: { outDir: "dist" },
  server: { host: true, port: 5174, hmr: false },
});

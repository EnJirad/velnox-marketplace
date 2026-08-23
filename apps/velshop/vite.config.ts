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
      "@velnox/ui/AvatarUpload": path.resolve(__dirname, "../../packages/ui/src/AvatarUpload.tsx"),
      "@velnox/ui/CurrencySelector": path.resolve(__dirname, "../../packages/ui/src/CurrencySelector.tsx"),
      "@velnox/ui/EmptyState": path.resolve(__dirname, "../../packages/ui/src/EmptyState.tsx"),
      "@velnox/ui/ErrorState": path.resolve(__dirname, "../../packages/ui/src/ErrorState.tsx"),
      "@velnox/ui/LanguageSelector": path.resolve(__dirname, "../../packages/ui/src/LanguageSelector.tsx"),
      "@velnox/ui/LoadingSpinner": path.resolve(__dirname, "../../packages/ui/src/LoadingSpinner.tsx"),
      "@velnox/ui/ProductCard": path.resolve(__dirname, "../../packages/ui/src/ProductCard.tsx"),
      "@velnox/ui/Skeleton": path.resolve(__dirname, "../../packages/ui/src/Skeleton.tsx"),
    },
    dedupe: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
  },
  build: {
    sourcemap: false,
    target: "esnext",
    minify: "esbuild",
    outDir: "dist",
  },
  server: {
    host: true,
    port: 5173,
    hmr: false,
  },
});

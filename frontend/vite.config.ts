import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  esbuild: {
    target: "es2020",
  },
  build: {
    target: "es2020",
    outDir: "dist",
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: "index.html",
        sw: "src/sw.ts",
      },
      output: {
        entryFileNames: "[name].js",
        manualChunks(id) {
          if (id.includes("maplibre-gl")) {
            return "maplibre-gl";
          }

          if (id.includes("better-auth")) {
            return "auth-vendor";
          }

          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  define: {
    "import.meta.env.VITE_API_URL": JSON.stringify(process.env.VITE_API_URL || "http://localhost:3000"),
  },
});

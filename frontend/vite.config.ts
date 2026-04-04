import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  esbuild: {
    target: "es2020",
  },
  build: {
    target: "es2020",
    outDir: "dist",
    rollupOptions: {
      input: {
        main: "index.html",
        sw: "src/sw.ts",
      },
      output: {
        entryFileNames: "[name].js",
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

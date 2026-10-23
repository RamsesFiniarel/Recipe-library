import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const apiPort = process.env.PORT || 3000;

export default defineConfig({
  root: ".",
  publicDir: "public",
  resolve: {
    alias: {
      // Modules shared with the Express server (colours, text helpers).
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  // Loaded on demand (photo reader, PDF), but prebundled at startup so the dev
  // server doesn't reload the page when it meets them.
  optimizeDeps: {
    include: ["tesseract.js", "jspdf"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The Three.js chunk (library page only) is about 835 kB: warn past that.
    chunkSizeWarningLimit: 850,
    rollupOptions: {
      // jsPDF's HTML and SVG rendering imports, never used: left out of the build.
      external: ["html2canvas", "dompurify", "canvg"],
    },
  },
});

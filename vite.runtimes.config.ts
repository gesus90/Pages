import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";

/** Independent Node entries never import the React Router server build. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  build: {
    ssr: true,
    target: "node22",
    outDir: "build",
    emptyOutDir: false,
    rollupOptions: {
      input: {
        "local-owner/index": "backend/agents/local/LocalSessionOwner.ts",
        "runs/index": "backend/runtime/RunsEntry.ts",
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "runtime-chunks/[name]-[hash].js",
      },
    },
  },
});

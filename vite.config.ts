import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

import type { Plugin } from "vite";

/**
 * Initializes the Pages runtime once the development server listens, so
 * the setup link names the actual port. The production server does the
 * same in `backend/runtime/PagesServer.ts`.
 */
function pagesDevelopmentRuntime(): Plugin {
  return {
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        void server
          .ssrLoadModule("/backend/runtime/DevelopmentRuntime.ts")
          .then((runtimeModule) =>
            runtimeModule.startDevelopmentRuntime([
              ...(server.resolvedUrls?.local ?? []),
              ...(server.resolvedUrls?.network ?? []),
            ]),
          );
      });
    },
    name: "pages-development-runtime",
  };
}

export default defineConfig({
  environments: {
    // The server build starts with the production server, which embeds the
    // React Router build (see backend/runtime/ServerEntry.ts).
    ssr: {
      build: {
        rollupOptions: {
          input: "./backend/runtime/ServerEntry.ts",
          // One file keeps the entry in `build/server`, where it finds the
          // client files relative to itself. Code the browser loads lazily,
          // such as the ticket description editor, must not split it.
          output: { inlineDynamicImports: true },
        },
      },
    },
  },
  // The dependency optimizer follows imports of server modules into the
  // browser scan and fails on the native DuckDB binaries (`.node` files).
  // Server code never runs in the browser, so the optimizer leaves them out.
  optimizeDeps: {
    exclude: ["@duckdb/node-api", "@duckdb/node-bindings"],
  },
  plugins: [tailwindcss(), reactRouter(), pagesDevelopmentRuntime()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});

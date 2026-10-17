import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

import type { Plugin } from "vite";
import type { DevelopmentRequestLogger } from "./backend/runtime/DevelopmentRuntime";

/** Pica's protected `SOUL.md` and `AGENTS.md` in the source tree (PAGE-51). */
const PICA_INSTRUCTION_SOURCE = new URL(
  "./backend/service/chat/pica/",
  import.meta.url,
);

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
            runtimeModule.startDevelopmentRuntime(
              [
                ...(server.resolvedUrls?.local ?? []),
                ...(server.resolvedUrls?.network ?? []),
              ],
              (listener: DevelopmentRequestLogger) => {
                server.middlewares.use(listener);
              },
            ),
          );
      });
    },
    name: "pages-development-runtime",
  };
}

/**
 * Ships Pica's protected files next to the server bundle, to
 * `build/server/pica/`, where `backend/service/chat/PicaInstructionFiles.ts`
 * reads them. The client build, which the server hands out, never holds them.
 */
function pagesPicaInstructions(): Plugin {
  return {
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "ssr",
    async generateBundle() {
      for (const fileName of await readdir(PICA_INSTRUCTION_SOURCE)) {
        this.emitFile({
          type: "asset",
          fileName: `pica/${fileName}`,
          source: await readFile(new URL(fileName, PICA_INSTRUCTION_SOURCE)),
        });
      }
    },
    name: "pages-pica-instructions",
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
  plugins: [
    tailwindcss(),
    reactRouter(),
    pagesDevelopmentRuntime(),
    pagesPicaInstructions(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});

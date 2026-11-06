import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { promisify } from "node:util";

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, transformWithEsbuild } from "vite";

import mcpManifest from "./mcp/package.json";
import appRoutes, { FORWARDED_RESOURCE } from "./app/routes";

import type { RouteConfigEntry } from "@react-router/dev/routes";
import type { Plugin } from "vite";
import { isForwardedRoute } from "./backend/runtime/AppRouteMatch";
import { SENSITIVE_DOCUMENT_PATHS } from "./app/lib/security-headers";

import type { AppRoute } from "./backend/runtime/AppRouteMatch";
import type { ServiceWorkerBuild } from "./app/service-worker/install-service-worker";
import type { DevelopmentRequestLogger } from "./backend/runtime/DevelopmentRuntime";

/** The API build or development server (PAGE-235); without it Vite serves the static app. */
const isApiBuild = process.env.PAGES_ROUTES === "api";

/** Where the static app's development server finds the API's (`pnpm dev:api`). */
const DEVELOPMENT_API = new URL(
  process.env.PAGES_DEV_API ?? "http://127.0.0.1:5174",
);

/** Source of the service worker, see `app/service-worker/install-service-worker.ts`. */
const SERVICE_WORKER_SOURCE = new URL(
  "./app/service-worker/install-service-worker.ts",
  import.meta.url,
);

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

/** Builds the independent MCP package at build time and ships only its standalone server artifact. */
function pagesMcpBundle(): Plugin {
  return {
    name: "pages-mcp-bundle",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "ssr",
    async generateBundle() {
      const directory = fileURLToPath(new URL("./mcp/", import.meta.url));
      await promisify(execFile)(process.execPath, ["build.config.ts"], {
        cwd: directory,
        timeout: 120_000,
      });
      const fileName = `pages-mcp-v${mcpManifest.version}.cjs`;
      this.emitFile({
        type: "asset",
        fileName,
        source: await readFile(
          new URL(`./mcp/dist/${fileName}`, import.meta.url),
        ),
      });
    },
  };
}

/**
 * Lists the full path patterns of the static app's routes.
 *
 * @param entries - Routes of `app/routes.ts`.
 * @param parentPath - Path of the enclosing routes.
 */
function listAppRoutes(
  entries: readonly RouteConfigEntry[],
  parentPath = "",
): AppRoute[] {
  return entries.flatMap((entry) => {
    const routePath = [parentPath, entry.path ?? ""]
      .filter((segment) => segment !== "")
      .join("/");
    if (entry.children && entry.children.length > 0)
      return listAppRoutes(entry.children, routePath);
    return [
      {
        path: `/${routePath}`,
        isForwarded: entry.file === FORWARDED_RESOURCE,
      },
    ];
  });
}

/** Compiles the service worker for the files of this build. */
async function createServiceWorker(assets: readonly string[]): Promise<string> {
  const routes = listAppRoutes(appRoutes);
  const build: ServiceWorkerBuild = {
    assets,
    forwarded: routes
      .filter((route) => route.isForwarded)
      .map((route) => route.path),
    sensitive: SENSITIVE_DOCUMENT_PATHS,
    version: createHash("sha256")
      .update(assets.join("\n"))
      .digest("hex")
      .slice(0, 16),
  };
  const compiled = await transformWithEsbuild(
    await readFile(SERVICE_WORKER_SOURCE, "utf8"),
    "install-service-worker.ts",
    { format: "iife", globalName: "pagesServiceWorker", target: "es2022" },
  );
  return `${compiled.code}pagesServiceWorker.installServiceWorker(self, ${JSON.stringify(build)});\n`;
}

/**
 * Passes the static app's server requests to the API's development server,
 * as the entrance does in production (PAGE-235).
 *
 * @remarks
 * `pnpm dev` serves the app, `pnpm dev:api` the API with the Pages runtime.
 * WebSocket upgrades are not passed on; Vite uses them for its own updates.
 */
function pagesDevelopmentApi(): Plugin {
  return {
    apply: "serve",
    configureServer(server) {
      const routes = listAppRoutes(appRoutes);
      server.middlewares.use((request, response, next) => {
        const { pathname } = new URL(request.url ?? "/", DEVELOPMENT_API);
        if (!isForwardedRoute(routes, request.method ?? "GET", pathname)) {
          next();
          return;
        }
        const upstream = httpRequest(
          {
            headers: request.headers,
            host: DEVELOPMENT_API.hostname,
            method: request.method,
            path: request.url,
            port: DEVELOPMENT_API.port,
          },
          (answer) => {
            response.writeHead(answer.statusCode ?? 502, answer.headers);
            answer.pipe(response);
          },
        );
        upstream.on("error", () => {
          response.statusCode = 502;
          response.end(
            "The API development server (pnpm dev:api) is not running.",
          );
        });
        request.pipe(upstream);
      });
    },
    name: "pages-development-api",
  };
}

/**
 * Writes what serves the static app next to its files (PAGE-235): the route
 * list the API and the entrance decide by (`.pages-routes.json`, see
 * `backend/runtime/AppRoutes.ts`) and the service worker (`sw.js`).
 */
function pagesStaticApp(): Plugin {
  return {
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    async generateBundle(_options, bundle) {
      const assets = Object.values(bundle)
        .map((file) => file.fileName)
        .filter((name) => name.startsWith("assets/") && !name.endsWith(".map"))
        .sort()
        .map((name) => `/${name}`);
      this.emitFile({
        type: "asset",
        fileName: ".pages-routes.json",
        source: JSON.stringify(listAppRoutes(appRoutes)),
      });
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: await createServiceWorker(assets),
      });
    },
    name: "pages-static-app",
  };
}

export default defineConfig({
  environments: {
    // The API's server build starts with the production server, which embeds
    // the React Router build (see backend/runtime/ServerEntry.ts). The static
    // app's build keeps React Router's own server entry; it renders only the
    // app's `index.html`.
    ...(isApiBuild
      ? {
          ssr: {
            build: {
              rollupOptions: {
                input: "./backend/runtime/ServerEntry.ts",
                // One file keeps the entry in `build/server`, where it finds
                // the client files relative to itself. Code the browser loads
                // lazily, such as the ticket description editor, must not
                // split it.
                output: { inlineDynamicImports: true },
              },
            },
          },
        }
      : {}),
  },
  // The dependency optimizer follows server imports while scanning routes.
  // Keep Node-only drivers and browser controllers out of its browser bundle:
  // canvas contains native binaries, pg opens sockets, and Playwright includes
  // lazy optional BiDi imports that the optimizer would resolve eagerly.
  optimizeDeps: {
    exclude: ["@napi-rs/canvas", "pg", "playwright-core"],
  },
  plugins: [
    tailwindcss(),
    reactRouter(),
    ...(isApiBuild
      ? [pagesDevelopmentRuntime(), pagesPicaInstructions(), pagesMcpBundle()]
      : [pagesDevelopmentApi(), pagesStaticApp()]),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});

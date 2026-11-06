import type { Config } from "@react-router/dev/config";

/**
 * The API build (`PAGES_ROUTES=api`, see `app/routes.ts`) is the server of
 * the static app: it holds no page component, so it renders no document.
 */
const isApiBuild = process.env.PAGES_ROUTES === "api";

export default {
  // The API is written to its own directory; `scripts/build.mjs` moves its
  // server bundle next to the static app.
  buildDirectory: isApiBuild ? "build/api" : "build",
  // Scans every route for dependencies on start, so the dev server bundles
  // them once instead of reloading the page whenever a route needs a new one.
  future: { unstable_optimizeDeps: true },
  // The interface is a static app without server rendering (PAGE-235). The
  // API needs server routes for its loaders, actions and resources.
  ssr: isApiBuild,
} satisfies Config;

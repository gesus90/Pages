import type { Config } from "@react-router/dev/config";

export default {
  // Scans every route for dependencies on start, so the dev server bundles
  // them once instead of reloading the page whenever a route needs a new one.
  future: { unstable_optimizeDeps: true },
  ssr: true,
} satisfies Config;

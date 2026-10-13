import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

/** Technical defaults only; neither application startup nor test discovery. */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    // Restrict aliases to production namespaces; tests and mcp are not targets.
    alias: {
      "@/app": fileURLToPath(new URL("./app", import.meta.url)),
      "@/assets": fileURLToPath(new URL("./assets", import.meta.url)),
      "@/backend": fileURLToPath(new URL("./backend", import.meta.url)),
      "@/definition": fileURLToPath(new URL("./definition", import.meta.url)),
      "@/language": fileURLToPath(new URL("./language", import.meta.url)),
    },
  },
  test: {
    globals: false,
    isolate: true,
    passWithNoTests: false,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: [
        ["text", { skipFull: false }],
        ["text", { file: "coverage.txt", skipFull: false }],
        "html",
        "json",
        "json-summary",
      ],
      reportOnFailure: true,
      skipFull: false,
    },
  },
});

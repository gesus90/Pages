import { spawn } from "node:child_process";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Builds Pages in two passes (PAGE-235):
 *
 * 1. the static app (`ssr: false`) into `build/client`, with its
 *    `index.html`, `sw.js` and route list;
 * 2. the API (`PAGES_ROUTES=api`) into `build/api`, whose server bundle is
 *    moved to `build/server`, where `server.mjs` and the other launchers
 *    load it.
 *
 * The static app's own server bundle only renders its `index.html` during
 * the build and is removed, as is the API's unused browser output.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "build");
// The package exports no path to its command; `node_modules/.bin` links it.
const REACT_ROUTER_CLI = path.join(
  ROOT,
  "node_modules",
  "@react-router",
  "dev",
  "bin.cjs",
);

function runBuild(routeTable) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [REACT_ROUTER_CLI, "build"], {
      cwd: ROOT,
      env: { ...process.env, PAGES_ROUTES: routeTable },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`The ${routeTable} build failed (${code}).`)),
    );
  });
}

await runBuild("spa");
await rm(path.join(BUILD, "server"), { recursive: true, force: true });
await runBuild("api");
await rename(path.join(BUILD, "api", "server"), path.join(BUILD, "server"));
await rm(path.join(BUILD, "api"), { recursive: true, force: true });
console.info("[pages] Static app in build/client, API in build/server.");

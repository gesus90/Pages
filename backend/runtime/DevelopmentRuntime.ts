import { resolveDefaultConfigPath } from "@/backend/config/PagesConfig";

import { announceServer } from "./PagesServer";
import { initializePagesRuntime } from "./PagesRuntime";

/**
 * Initializes the runtime inside the development server.
 *
 * @param serverUrls - Addresses the development server listens on, as
 * reported by Vite, for example `http://localhost:5173/`.
 *
 * @remarks
 * The development server is not started through `server.mjs`, so a Vite
 * plugin calls this once it listens. It reads `~/.pages/config.toml` like
 * the production server and prints the setup link with the actual port.
 * Start parameters and the configured port do not apply here.
 */
export async function startDevelopmentRuntime(
  serverUrls: readonly string[],
): Promise<void> {
  try {
    const runtime = await initializePagesRuntime(resolveDefaultConfigPath());

    announceServer(
      runtime,
      serverUrls.map((url) => url.replace(/\/$/u, "")),
    );
  } catch (error: unknown) {
    console.error("[pages] The configuration could not be loaded.", error);
  }
}

import { getApplicationServices } from "@/app/lib/services.server";
import { logDiagnostic } from "@/backend/logging/Logger";
import { PagesPicaMobileAuthenticator } from "@/backend/service/mobile/PicaMobileAuthenticator";
import { PicaMobileGateway } from "@/backend/service/mobile/PicaMobileGateway";
import { PAGES_VERSION } from "@/definition/Version";

import { registerShutdownTask } from "./ProcessLifecycle";

import type { PagesRuntime } from "./PagesRuntime";

declare global {
  var pagesPicaMobileGateway: PicaMobileGateway | undefined;
}

/**
 * Returns the Pica Mobile endpoint of the process, creating it on first use.
 *
 * @param runtime - Runtime of the process.
 * @param webPort - Port of the Pages web server, when it is known; the
 * endpoint refuses to take it.
 * @returns The one gateway of the process; it listens nowhere until it is told to.
 */
export function obtainPicaMobileGateway(
  runtime: PagesRuntime,
  webPort?: number,
): PicaMobileGateway {
  if (globalThis.pagesPicaMobileGateway === undefined) {
    const gateway = new PicaMobileGateway({
      authenticator: new PagesPicaMobileAuthenticator(
        async () => (await getApplicationServices()).authService,
      ),
      serverVersion: PAGES_VERSION,
      listenAddress: runtime.getConfig().listenAddress,
      reservedPort: webPort,
    });

    globalThis.pagesPicaMobileGateway = gateway;
    registerShutdownTask(() => gateway.close());
  }

  return globalThis.pagesPicaMobileGateway;
}

/**
 * Starts the Pica Mobile endpoint on the stored port, when there is one.
 *
 * @param runtime - Runtime of the process.
 * @param webPort - Port the Pages web server listens on.
 *
 * @remarks
 * A port that cannot be bound is logged and reported to the operator; the web
 * server keeps running, and an administrator can store another port.
 */
export async function startPicaMobile(
  runtime: PagesRuntime,
  webPort: number,
): Promise<void> {
  const gateway = obtainPicaMobileGateway(runtime, webPort);
  const port = runtime.getConfig().picaMobilePort;

  if (port === undefined) {
    return;
  }

  try {
    await gateway.switchTo(port, () => Promise.resolve());
  } catch (error: unknown) {
    logDiagnostic(
      "PicaMobileRuntime",
      "warn",
      `[pages] Pica Mobile cannot listen on port ${port}. Store another port in Settings > Connections.`,
      error,
    );
  }
}

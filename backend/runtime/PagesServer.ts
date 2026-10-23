import { createServer } from "node:http";
import { networkInterfaces } from "node:os";

import { createRequestListener } from "@remix-run/node-fetch-server";
import { createRequestHandler, RouterContextProvider } from "react-router";

import { clientSocketAddressContext } from "@/app/lib/client-address.server";
import {
  ConfigError,
  resolveDefaultConfigPath,
} from "@/backend/config/PagesConfig";
import {
  parseStartOptions,
  START_USAGE,
  StartOptionsError,
} from "@/backend/config/StartOptions";
import {
  logCaughtError,
  logDiagnostic,
  logEvent,
} from "@/backend/logging/Logger";

import { startAgentTools } from "./AgentToolsStartup";
import { installRunnerChannel } from "./RunnerChannel";
import { startPicaMobile } from "./PicaMobileRuntime";
import { createForwardedHttpsCheck } from "./ForwardedProtocol";
import { initializePagesRuntime } from "./PagesRuntime";
import { serveStaticAsset } from "./StaticAssets";
import { logRequest } from "./RequestLogging";
import { withLoggedRoutes } from "./LoggedRoutes";
import {
  installProcessLogging,
  registerShutdownTask,
} from "./ProcessLifecycle";

import type { RequestListener, Server } from "node:http";
import type { FetchHandler } from "@remix-run/node-fetch-server";
import type { ServerBuild } from "react-router";
import type { PagesRuntime } from "./PagesRuntime";

/** What the production server needs from its build. */
export interface PagesServerOptions {
  /** Command-line arguments after the script name. */
  readonly argumentList: readonly string[];
  /** Server build of the application. */
  readonly build: ServerBuild;
  /** Absolute path of the client build output. */
  readonly clientDirectory: string;
}

const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;

/**
 * Lists the addresses the server can be reached at.
 *
 * @param port - Port the server listens on.
 * @returns `localhost` first, then every external IPv4 address.
 */
export function listServerOrigins(port: number): string[] {
  const externalAddresses = Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => address.family === "IPv4" && !address.internal)
    .map((address) => `http://${address.address}:${port}`);

  return [`http://localhost:${port}`, ...externalAddresses];
}

/**
 * Announces the server and writes a pending setup link directly to operator stdout.
 *
 * @param runtime - Runtime of the process.
 * @param origins - Addresses the server can be reached at.
 *
 * @remarks
 * The operator console is the only output for the setup capability. It must
 * bypass the logger, including its normal console mirror and error paths.
 */
export function announceServer(
  runtime: PagesRuntime,
  origins: readonly string[],
): void {
  logDiagnostic(
    "PagesServer",
    "info",
    `[pages] Pages is running at ${origins.join(" and ")}.`,
  );

  const token = runtime.getSetupToken();

  if (token === null) {
    return;
  }

  process.stdout.write(
    "[pages] Pages is not set up yet. Open the setup wizard with this one-time link:\n",
  );
  for (const origin of origins)
    process.stdout.write(`[pages]   ${origin}/setup?token=${token}\n`);
}

/**
 * Creates the request listener of the production server.
 *
 * @param build - Server build of the application.
 * @param clientDirectory - Absolute path of the client build output.
 * @param trustedProxies - Addresses or ranges of reverse proxies whose
 * `X-Forwarded-Proto` is believed; empty by default.
 * @returns A listener that serves build files first and the application
 * otherwise. Request logs omit queries, headers, bodies and opaque path segments.
 *
 * @remarks
 * A request that a trusted proxy forwarded from HTTPS is given an `https:`
 * URL, so React Router compares the browser's `Origin` with the address the
 * browser used. The comparison itself stays on for every request.
 */
export function createPagesRequestListener(
  build: ServerBuild,
  clientDirectory: string,
  trustedProxies: readonly string[] = [],
): RequestListener {
  const handleRequest = createRequestHandler(
    withLoggedRoutes(build),
    "production",
  );
  const handleFetch: FetchHandler = (request, client) => {
    const context = new RouterContextProvider();
    context.set(clientSocketAddressContext, client.address);
    return handleRequest(request, context);
  };
  const handleDirect = createRequestListener(handleFetch);
  const handleForwardedHttps = createRequestListener(handleFetch, {
    protocol: "https:",
  });
  const isForwardedHttps = createForwardedHttpsCheck(trustedProxies);

  return (request, response) => {
    logRequest(request, response, () => {
      void (async () => {
        try {
          if (!(await serveStaticAsset(request, response, clientDirectory))) {
            const handleApplication = isForwardedHttps(request)
              ? handleForwardedHttps
              : handleDirect;
            await handleApplication(request, response);
          }
        } catch (error: unknown) {
          logCaughtError("PagesServer", error);

          logEvent({
            level: "error",
            event: "http.request.failed",
            component: "PagesServer",
            message: "Request listener failed",
            error,
          });
          if (!response.headersSent) {
            response.statusCode = 500;
            response.end("Internal Server Error");
          } else response.destroy();
        }
      })();
    });
  };
}

function describeListenError(error: unknown, port: number): string | null {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : null;

  if (code === "EADDRINUSE") {
    return `[pages] Port ${port} is already in use. Stop the other program, start Pages with --port <number>, or change "port" in the configuration.`;
  }

  if (code === "EACCES") {
    return `[pages] Port ${port} cannot be used without more privileges. Start Pages with --port <number> above 1023, or change "port" in the configuration.`;
  }

  return null;
}

function listen(server: Server, port: number, address?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, address, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

/**
 * Stores a `--port` start parameter in the configuration.
 *
 * @remarks
 * Runs after the server listens, so a port that cannot be used is never
 * written. A failed write only costs the override on the next start.
 */
async function persistPort(runtime: PagesRuntime, port: number): Promise<void> {
  if (runtime.getConfig().port === port) {
    return;
  }

  try {
    await runtime.configFile.update((config) => ({ ...config, port }));
  } catch (error: unknown) {
    logCaughtError("PagesServer", error);

    logDiagnostic(
      "PagesServer",
      "warn",
      `[pages] The port ${port} could not be stored.`,
      error,
    );
  }
}

async function loadRuntime(argumentList: readonly string[]): Promise<{
  readonly runtime: PagesRuntime;
  readonly port: number;
  readonly isPortGiven: boolean;
} | null> {
  try {
    const startOptions = parseStartOptions(argumentList);
    const runtime = await initializePagesRuntime(
      startOptions.configPath ?? resolveDefaultConfigPath(),
    );

    return {
      isPortGiven: startOptions.port !== null,
      port: startOptions.port ?? runtime.getConfig().port,
      runtime,
    };
  } catch (error: unknown) {
    logCaughtError("PagesServer", error);

    if (error instanceof StartOptionsError) {
      logDiagnostic(
        "PagesServer",
        "error",
        `[pages] Unknown start parameter or invalid value.\n\n${START_USAGE}`,
        error,
      );

      return null;
    }

    if (error instanceof ConfigError) {
      logDiagnostic("PagesServer", "error", `[pages] ${error.message}`, error);

      return null;
    }

    throw error;
  }
}

/**
 * Starts the Pages production server.
 *
 * @param options - Arguments and build output.
 * @returns The process exit code; `0` while the server runs.
 *
 * @remarks
 * Start parameters win over the configuration file, which wins over the
 * defaults. A port that is taken ends the start with a message instead of
 * silently moving to another port.
 */
export async function startPagesServer(
  options: PagesServerOptions,
): Promise<number> {
  installProcessLogging();
  const loaded = await loadRuntime(options.argumentList);

  if (loaded === null) {
    return EXIT_FAILURE;
  }

  const { runtime, port, isPortGiven } = loaded;
  const server = createServer(
    createPagesRequestListener(
      options.build,
      options.clientDirectory,
      runtime.getConfig().trustedProxies,
    ),
  );
  installRunnerChannel(server);
  registerShutdownTask(async () => {
    server.close();
    server.closeIdleConnections();
  });

  try {
    await listen(server, port, runtime.getConfig().listenAddress);
  } catch (error: unknown) {
    logCaughtError("PagesServer", error);

    const message = describeListenError(error, port);

    if (message === null) {
      throw error;
    }

    logDiagnostic("PagesServer", "error", message);

    return EXIT_FAILURE;
  }

  if (isPortGiven) {
    await persistPort(runtime, port);
  }

  void startAgentTools(runtime);
  void startPicaMobile(runtime, port);
  const address = runtime.getConfig().listenAddress;
  const origins =
    address && !["0.0.0.0", "::"].includes(address)
      ? [`http://${address.includes(":") ? `[${address}]` : address}:${port}`]
      : listServerOrigins(port);
  announceServer(runtime, origins);

  return EXIT_SUCCESS;
}

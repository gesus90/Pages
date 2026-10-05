import { createServer } from "node:http";
import { networkInterfaces } from "node:os";

import { createRequestListener } from "@react-router/node";

import {
  ConfigError,
  resolveDefaultConfigPath,
} from "@/backend/config/PagesConfig";
import {
  parseStartOptions,
  START_USAGE,
  StartOptionsError,
} from "@/backend/config/StartOptions";

import { initializePagesRuntime } from "./PagesRuntime";
import { serveStaticAsset } from "./StaticAssets";

import type { RequestListener, Server } from "node:http";
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
 * Prints where Pages runs and, while the setup is pending, the setup link.
 *
 * @param runtime - Runtime of the process.
 * @param origins - Addresses the server can be reached at.
 *
 * @remarks
 * The operator console is the only place the setup token is ever written to.
 */
export function announceServer(
  runtime: PagesRuntime,
  origins: readonly string[],
): void {
  console.info(`[pages] Pages is running at ${origins.join(" and ")}.`);

  const token = runtime.getSetupToken();

  if (token === null) {
    return;
  }

  console.info(
    "[pages] Pages is not set up yet. Open the setup wizard with this one-time link:",
  );

  for (const origin of origins) {
    console.info(`[pages]   ${origin}/setup?token=${token}`);
  }
}

/**
 * Creates the request listener of the production server.
 *
 * @param build - Server build of the application.
 * @param clientDirectory - Absolute path of the client build output.
 * @returns A listener that serves build files first and the application
 * otherwise. Requests are not logged, so setup links never reach a log.
 */
export function createPagesRequestListener(
  build: ServerBuild,
  clientDirectory: string,
): RequestListener {
  const handleApplication = createRequestListener({
    build,
    mode: "production",
  });

  return (request, response) => {
    void serveStaticAsset(request, response, clientDirectory).then(
      (isServed) => {
        if (!isServed) {
          void handleApplication(request, response);
        }
      },
    );
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

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
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
    console.warn(`[pages] The port ${port} could not be stored.`, error);
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
    if (error instanceof StartOptionsError) {
      console.error(`[pages] ${error.message}\n\n${START_USAGE}`);

      return null;
    }

    if (error instanceof ConfigError) {
      console.error(`[pages] ${error.message}`);

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
  const loaded = await loadRuntime(options.argumentList);

  if (loaded === null) {
    return EXIT_FAILURE;
  }

  const { runtime, port, isPortGiven } = loaded;
  const server = createServer(
    createPagesRequestListener(options.build, options.clientDirectory),
  );

  try {
    await listen(server, port);
  } catch (error: unknown) {
    const message = describeListenError(error, port);

    if (message === null) {
      throw error;
    }

    console.error(message);

    return EXIT_FAILURE;
  }

  if (isPortGiven) {
    await persistPort(runtime, port);
  }

  announceServer(runtime, listServerOrigins(port));

  return EXIT_SUCCESS;
}

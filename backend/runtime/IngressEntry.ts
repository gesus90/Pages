import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ConfigFile } from "@/backend/config/ConfigFile";
import {
  initializeLogging,
  logEvent,
  updateLogRetention,
} from "@/backend/logging/Logger";
import { DEFAULT_LOG_RETENTION_DAYS } from "@/definition/Logging";

import { createIngressServer } from "./Ingress";
import {
  installProcessLogging,
  registerShutdownTask,
  shutdownProcess,
} from "./ProcessLifecycle";

import type { PagesConfig } from "@/backend/config/PagesConfig";

const USAGE =
  "Usage: node pages-ingress.mjs --config /absolute/config.toml --listen <address>:<port> --backend http://127.0.0.1:<port> [--core http://127.0.0.1:<port>] [--service-status http://127.0.0.1:<port>] [--core-runner http://127.0.0.1:<port>] [--core-console http://127.0.0.1:<port>]";

/** What the entrance is started with. */
interface IngressArguments {
  /** Its log files go below the instance logs next to this configuration. */
  readonly configPath: string;
  readonly address: string;
  readonly port: number;
  readonly backend: URL;
  /** Set: `pages-core` serves the live stream (PAGE-237). */
  readonly core?: URL;
  /** Set: `pages-core` serves the service status (PAGE-238). */
  readonly serviceStatus?: URL;
  /** Set: `pages-core` relays the runner channels (PAGE-239). */
  readonly coreRunner?: URL;
  /** Set: `pages-core` relays the console channels (PAGE-239). */
  readonly coreConsole?: URL;
}

/** The optional switches to `pages-core`, each an origin like `--backend`. */
const SWITCH_OPTIONS = {
  "--core": "core",
  "--service-status": "serviceStatus",
  "--core-runner": "coreRunner",
  "--core-console": "coreConsole",
} as const;

/** An `IngressArguments` key set by one of the switches. */
type SwitchKey = (typeof SWITCH_OPTIONS)[keyof typeof SWITCH_OPTIONS];

function readListen(value: string): { address: string; port: number } {
  const separator = value.lastIndexOf(":");
  const address = value.slice(0, separator).replace(/^\[|\]$/gu, "");
  const port = Number(value.slice(separator + 1));
  if (
    isIP(address) === 0 ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  )
    throw new Error(USAGE);
  return { address, port };
}

function readBackend(value: string): URL {
  const backend = new URL(value);
  if (backend.protocol !== "http:" || backend.port === "")
    throw new Error(USAGE);
  return backend;
}

function readSwitches(
  values: ReadonlyMap<string, string>,
): Partial<Record<SwitchKey, URL>> {
  const switches: Partial<Record<SwitchKey, URL>> = {};
  for (const [option, key] of Object.entries(SWITCH_OPTIONS)) {
    const value = values.get(option);
    if (value !== undefined) switches[key] = readBackend(value);
  }
  return switches;
}

/**
 * Starts the entrance's own logs with the instance's retention.
 *
 * @param configPath - The instance's `config.toml`.
 * @returns The configuration the retention was read from, or `null` when the
 * file does not exist.
 *
 * @remarks
 * The entrance writes to `log/ingress/` with a lock of its own. Sharing the
 * API's directory would let it take the API's single writer lock while the
 * API restarts, and the API would stay without its files. A changed retention
 * applies to the entrance after its next start. An invalid configuration ends
 * the start, as it does for the API.
 */
async function startIngressLogging(
  configPath: string,
): Promise<PagesConfig | null> {
  await initializeLogging(configPath, "ingress");
  const config = await new ConfigFile(configPath).read();
  await updateLogRetention(
    config?.logRetentionDays ?? DEFAULT_LOG_RETENTION_DAYS,
    "startup",
  );
  return config;
}

/** Records which proxies the entrance believes, so a misconfiguration shows at the start. */
function announceForwarding(trustedProxies: readonly string[]): void {
  logEvent({
    level: "info",
    event: "ingress.forwarding.configured",
    component: "IngressEntry",
    message: `X-Forwarded-* headers are believed from loopback peers and ${trustedProxies.length} proxy entries of trustedProxies`,
    metadata: { count: trustedProxies.length },
  });
}

function parseIngressArguments(
  argumentList: readonly string[],
): IngressArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argumentList.length; index += 2) {
    const name = argumentList[index];
    const value = argumentList[index + 1];
    if (!name || value === undefined || values.has(name))
      throw new Error(USAGE);
    values.set(name, value);
  }
  const configPath = values.get("--config");
  const listen = values.get("--listen");
  const backend = values.get("--backend");
  const switches = readSwitches(values);
  if (
    values.size !== 3 + Object.keys(switches).length ||
    !configPath ||
    !path.isAbsolute(configPath) ||
    !listen ||
    !backend
  )
    throw new Error(USAGE);
  return {
    configPath,
    ...readListen(listen),
    backend: readBackend(backend),
    ...switches,
  };
}

/**
 * Starts the static app's entrance as its own process (PAGE-235).
 *
 * @param argumentList - Command-line arguments after the script name.
 *
 * @remarks
 * Part of the same versioned bundle as the API, like `pages-runs`, but it
 * opens no database and starts no service: stopping or restarting the API
 * leaves the entrance and the static app available. It reads the
 * `trustedProxies` of the instance's configuration, the setting the API reads,
 * so both decide on the same proxies.
 */
export async function startIngress(
  argumentList: readonly string[],
): Promise<void> {
  installProcessLogging();
  try {
    const options = parseIngressArguments(argumentList);
    const config = await startIngressLogging(options.configPath);
    const trustedProxies = config?.trustedProxies ?? [];
    const server = createIngressServer({
      backend: options.backend,
      trustedProxies,
      core: options.core,
      serviceStatus: options.serviceStatus,
      coreRunner: options.coreRunner,
      coreConsole: options.coreConsole,
      clientDirectory: fileURLToPath(new URL("../client", import.meta.url)),
    });
    registerShutdownTask(
      async () => {
        server.close();
        server.closeIdleConnections();
      },
      { step: "http_server" },
    );
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, options.address, () => {
        server.off("error", reject);
        resolve();
      });
    });
    logEvent({
      level: "info",
      event: "ingress.started",
      component: "IngressEntry",
      message: `Static app entrance listens on ${options.address}:${options.port}`,
      metadata: {
        backend: options.backend.origin,
        source: options.core ? "core" : "api",
        origin: options.core?.origin ?? null,
        status: options.serviceStatus?.origin ?? null,
        runner: options.coreRunner?.origin ?? null,
        console: options.coreConsole?.origin ?? null,
      },
    });
    announceForwarding(trustedProxies);
  } catch (error: unknown) {
    await shutdownProcess(1, "ingress_startup", error);
  }
}

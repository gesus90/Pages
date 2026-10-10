import { readConfiguration } from "./configuration.js";

/** Explicit audience, Pages issuer and loopback listener; no personal token participates in HTTP mode. */
export interface HttpConfiguration {
  readonly issuer: string;
  readonly agentsUrl: URL;
  readonly resource: URL;
  readonly host: string;
  readonly port: number;
}

const HTTP_OPTION_MESSAGES = {
  usage:
    "Use --http --resource URL [--port PORT] [--host 127.0.0.1|::1|localhost].",
  resource:
    "--resource must be an HTTPS (or loopback HTTP) URL ending in /mcp, without credentials, query or fragment.",
  host: "--host accepts only 127.0.0.1, ::1 or localhost; remote access needs a TLS reverse proxy.",
  port: "--port must be an integer from 1 to 65535.",
  pages: "In HTTP mode PAGES_URL must be the instance origin without a path.",
} as const;

const OPTION_NAMES = new Set<string>(["--resource", "--port", "--host"]);
const LOOPBACK_HOSTS = new Set<string>(["127.0.0.1", "::1", "localhost"]);
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8998;
const CONFIGURATION_ONLY_TOKEN = "configuration-only";

/**
 * Startup option failure whose message is fixed text; it never contains an option or environment value,
 * so the start routine may print it.
 */
export class HttpOptionError extends Error {
  public constructor(problem: keyof typeof HTTP_OPTION_MESSAGES) {
    super(HTTP_OPTION_MESSAGES[problem]);
  }
}

function readOptions(argumentsList: readonly string[]): Map<string, string> {
  const [mode, ...pairs] = argumentsList;
  if (mode !== "--http" || pairs.length % 2 !== 0) {
    throw new HttpOptionError("usage");
  }
  const options = new Map<string, string>();
  for (let index = 0; index < pairs.length; index += 2) {
    const name = pairs[index];
    if (!OPTION_NAMES.has(name) || options.has(name)) {
      throw new HttpOptionError("usage");
    }
    options.set(name, pairs[index + 1]);
  }
  return options;
}

function readResource(value: string | undefined): URL {
  if (value === undefined) {
    throw new HttpOptionError("usage");
  }
  let resource: URL;
  try {
    const configuration = readConfiguration({
      PAGES_URL: value,
      PAGES_TOKEN: CONFIGURATION_ONLY_TOKEN,
    });
    resource = new URL(
      configuration.agentsUrl.href.replace(/\/api\/v1\/agents$/, ""),
    );
  } catch {
    throw new HttpOptionError("resource");
  }
  if (resource.pathname !== "/mcp") {
    throw new HttpOptionError("resource");
  }
  return resource;
}

function readHost(value: string | undefined): string {
  const host = value ?? DEFAULT_HOST;
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new HttpOptionError("host");
  }
  return host;
}

function readPort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new HttpOptionError("port");
  }
  return port;
}

/**
 * Reads the HTTP mode flag, public resource, loopback host and port, retaining the secure Pages URL rules.
 *
 * @param environment - Process environment; only `PAGES_URL` is read.
 * @param argumentsList - Command-line arguments after the program name.
 * @returns The validated listener configuration.
 * @throws {HttpOptionError} When an option is missing, repeated, unknown or outside its allowed values.
 */
export function readHttpConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
  argumentsList: readonly string[],
): HttpConfiguration {
  const options = readOptions(argumentsList);
  const resource = readResource(options.get("--resource"));
  const host = readHost(options.get("--host"));
  const port = readPort(options.get("--port"));
  const pages = readConfiguration({
    PAGES_URL: environment.PAGES_URL,
    PAGES_TOKEN: CONFIGURATION_ONLY_TOKEN,
  });
  if (pages.agentsUrl.pathname !== "/api/v1/agents") {
    throw new HttpOptionError("pages");
  }
  return {
    issuer: pages.agentsUrl.origin,
    agentsUrl: pages.agentsUrl,
    resource,
    host,
    port,
  };
}

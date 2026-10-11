import { isIPv4 } from "node:net";

import { readConfiguration } from "./configuration.js";

/** Explicit audience, Pages issuer and local listener; no personal token participates in HTTP mode. */
export interface HttpConfiguration {
  readonly issuer: string;
  readonly agentsUrl: URL;
  readonly resource: URL;
  readonly host: string;
  readonly port: number;
}

const HTTP_OPTION_MESSAGES = {
  usage: "Use --http --resource URL [--port PORT] [--host HOST].",
  resource:
    "--resource must be an HTTPS (or loopback/private IPv4 HTTP) URL ending in /mcp, without credentials, query or fragment.",
  host: "--host accepts only 127.0.0.1, ::1, localhost or a private IPv4 address (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16).",
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

function isPrivateIpv4(host: string): boolean {
  if (!isIPv4(host)) {
    return false;
  }
  const [firstOctet, secondOctet] = host.split(".").map(Number);
  return (
    firstOctet === 10 ||
    (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) ||
    (firstOctet === 192 && secondOctet === 168)
  );
}

function readResource(value: string | undefined): URL {
  if (value === undefined) {
    throw new HttpOptionError("usage");
  }
  if (value.trim() !== value) {
    throw new HttpOptionError("resource");
  }
  let resource: URL;
  try {
    resource = new URL(value);
  } catch {
    throw new HttpOptionError("resource");
  }
  resource.pathname = resource.pathname.replace(/\/$/, "");
  const isLocalResource =
    resource.hostname === "[::1]" ||
    LOOPBACK_HOSTS.has(resource.hostname) ||
    isPrivateIpv4(resource.hostname);
  if (
    (resource.protocol !== "https:" &&
      !(resource.protocol === "http:" && isLocalResource)) ||
    resource.username !== "" ||
    resource.password !== "" ||
    resource.search !== "" ||
    resource.hash !== "" ||
    resource.pathname !== "/mcp"
  ) {
    throw new HttpOptionError("resource");
  }
  return resource;
}

function readHost(value: string | undefined): string {
  const host = value ?? DEFAULT_HOST;
  if (!LOOPBACK_HOSTS.has(host) && !isPrivateIpv4(host)) {
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
 * Reads the HTTP mode flag, resource, loopback/private IPv4 host and port, retaining the secure Pages URL rules.
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

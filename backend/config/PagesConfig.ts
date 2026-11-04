import { homedir } from "node:os";
import path from "node:path";

import { interpreterProfilesSchema } from "@/definition/InterpreterProfile";
import { isLogRetentionDays } from "@/definition/Logging";
import { PICA_MOBILE_REPLAY_TTL_RANGE_SECONDS } from "@/definition/PicaMobileNotifications";

import { logCaughtError } from "@/backend/logging/Logger";

import { readAgentGitBridges } from "./AgentGitBridgeConfig";
import { readMcpHttpConfig } from "./McpHttpConfig";

import { readAcpResourceSettings } from "./AcpResourceSettings";
import { parseTrustedProxyEntry } from "./TrustedProxies";

import type { AgentGitBridgeSetting } from "./AgentGitBridgeConfig";
import type { McpHttpConfig } from "./McpHttpConfig";
import type { InterpreterProfile } from "@/definition/InterpreterProfile";
import type { AcpResourceOptions } from "@/definition/AcpResource";
import type { TomlTable } from "smol-toml";

const PAGES_DIRECTORY_NAME = ".pages";
const CONFIG_FILE_NAME = "config.toml";
const DATA_DIRECTORY_NAME = "data";
const AGENTS_DIRECTORY_NAME = "Agents";
const DATABASE_FILE_NAME = "pages.duckdb";

/** Port the server listens on when neither a start parameter nor the configuration names one. */
export const DEFAULT_PORT = 3000;

const HIGHEST_PORT = 65_535;

/** Keys Pages reads from and writes to the configuration file. */
export const CONFIG_KEY = {
  FIRST_RUN: "firstRun",
  PORT: "port",
  DATABASE_PATH: "databasePath",
  DATABASE_URL: "databaseUrl",
} as const;

/** Settings that do not depend on the setup state. */
interface BaseConfig extends Partial<AcpResourceOptions> {
  readonly port: number;
  readonly listenAddress?: string;
  readonly mcpHttp?: McpHttpConfig;
  /** Port of the Pica Mobile WebSocket endpoint; missing: the endpoint is off. */
  readonly picaMobilePort?: number;
  /**
   * Absolute path of the Google service-account key file Pages uses to send
   * Pica Mobile push notifications through FCM; missing: no push is offered.
   */
  readonly picaMobileFcmServiceAccountFile?: string;
  /** Seconds a push notification stays worth delivering, 60 to 3600; missing: 900. */
  readonly picaMobileReplayTtlSeconds?: number;
  readonly interpreterProfiles?: readonly InterpreterProfile[];
  /** Missing on older configurations: 30 calendar days, including today. */
  readonly logRetentionDays?: number;
  /**
   * Addresses or ranges of the reverse proxies whose `X-Forwarded-Proto` is
   * believed. Missing: no proxy is trusted and the header is ignored.
   */
  readonly trustedProxies?: readonly string[];
  /** Host Git routes for single plan steps; missing: no session gets one. */
  readonly agentGitBridges?: readonly AgentGitBridgeSetting[];
  /**
   * Origins of local services the visual operator browser of Pica may reach
   * besides this Pages instance, such as `http://127.0.0.1:8080`. Missing: none.
   */
  readonly picaBrowserLocalOrigins?: readonly string[];
}

/**
 * Configuration while the setup wizard is available.
 *
 * @remarks
 * The database path is only set after a manual reset of a finished setup;
 * the wizard then suggests it again.
 */
export interface PendingSetupConfig extends BaseConfig {
  readonly firstRun: true;
  readonly databasePath: string | null;
}

/** Configuration of an instance whose setup finished. */
export interface CompletedSetupConfig extends BaseConfig {
  readonly firstRun: false;
  /**
   * Still names the data directory next to the database, such as the GitHub
   * token key, when {@link databaseUrl} selects PostgreSQL.
   */
  readonly databasePath: string;
  /**
   * Connection URL of the PostgreSQL database; missing: DuckDB at
   * {@link databasePath}. A secret: it never reaches a log line or a client.
   */
  readonly databaseUrl?: string;
}

/**
 * The instance configuration stored in `config.toml`.
 *
 * @remarks
 * `firstRun` keeps the setup wizard available until a setup finished.
 */
export type PagesConfig = PendingSetupConfig | CompletedSetupConfig;

/** The configuration of an instance that was never set up. */
export const DEFAULT_CONFIG: PendingSetupConfig = {
  databasePath: null,
  firstRun: true,
  port: DEFAULT_PORT,
};

/** Raised when the configuration file cannot be read or holds invalid values. */
export class ConfigError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigError";
  }
}

/**
 * Tells whether a value is a port a server can listen on.
 *
 * @param value - Candidate port.
 * @returns Whether it is an integer from 1 to 65535.
 */
export function isValidPort(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= HIGHEST_PORT
  );
}

/**
 * Returns the configuration file used without a `--config` start parameter.
 *
 * @returns `~/.pages/config.toml` of the current user.
 * @throws {ConfigError} When the home directory cannot be determined.
 */
export function resolveDefaultConfigPath(): string {
  const homeDirectory = homedir();

  if (!homeDirectory) {
    throw new ConfigError(
      "Pages could not determine the home directory of the current user.",
    );
  }

  return path.join(homeDirectory, PAGES_DIRECTORY_NAME, CONFIG_FILE_NAME);
}

/**
 * Returns the data directory that belongs to a configuration file.
 *
 * @param configPath - Absolute path of the configuration file.
 * @returns `data/` next to the configuration, `~/.pages/data` by default.
 */
export function resolveDefaultDataDirectory(configPath: string): string {
  return path.join(path.dirname(configPath), DATA_DIRECTORY_NAME);
}

/**
 * Returns the database path the setup wizard suggests for a new instance.
 *
 * @param configPath - Absolute path of the configuration file.
 * @returns `pages.duckdb` inside the default data directory.
 */
export function resolveDefaultDatabasePath(configPath: string): string {
  return path.join(resolveDefaultDataDirectory(configPath), DATABASE_FILE_NAME);
}

/**
 * Returns the directory of the agent folders that belongs to a configuration file.
 *
 * @param configPath - Absolute path of the configuration file.
 * @returns `Agents/` next to the configuration, `~/.pages/Agents` by default.
 *
 * @remarks
 * It is separate from the data directory (T6.15.1); each agent keeps its fixed
 * `AGENT.md` and its run records in a folder named by its identifier.
 */
export function resolveAgentsDirectory(configPath: string): string {
  return path.join(path.dirname(configPath), AGENTS_DIRECTORY_NAME);
}

function invalidConfig(source: string, detail: string): ConfigError {
  return new ConfigError(
    `The configuration file "${source}" is invalid: ${detail}`,
  );
}

function readFirstRun(table: TomlTable, source: string): boolean {
  const value = table[CONFIG_KEY.FIRST_RUN];

  if (value === undefined) {
    return DEFAULT_CONFIG.firstRun;
  }

  if (typeof value !== "boolean") {
    throw invalidConfig(
      source,
      `"${CONFIG_KEY.FIRST_RUN}" must be true or false.`,
    );
  }

  return value;
}

function readPort(table: TomlTable, source: string): number {
  const value = table[CONFIG_KEY.PORT];

  if (value === undefined) {
    return DEFAULT_PORT;
  }

  if (!isValidPort(value)) {
    throw invalidConfig(
      source,
      `"${CONFIG_KEY.PORT}" must be a whole number from 1 to ${HIGHEST_PORT}.`,
    );
  }

  return value;
}

function readDatabasePath(table: TomlTable, source: string): string | null {
  const value = table[CONFIG_KEY.DATABASE_PATH];

  if (value === undefined) {
    return null;
  }

  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw invalidConfig(
      source,
      `"${CONFIG_KEY.DATABASE_PATH}" must be an absolute file path.`,
    );
  }

  return path.normalize(value);
}

function isPostgresUrl(value: string): boolean {
  try {
    const { protocol, password } = new URL(value);
    // The driver decodes the password; a bad escape would only fail at the start.
    decodeURIComponent(password);
    return protocol === "postgres:" || protocol === "postgresql:";
  } catch {
    // The parser error quotes its input, and this input holds a password.
    return false;
  }
}

function readDatabaseUrl(
  table: TomlTable,
  source: string,
  firstRun: boolean,
): Pick<CompletedSetupConfig, "databaseUrl"> {
  const value = table[CONFIG_KEY.DATABASE_URL];
  if (value === undefined) return {};
  // The messages never quote the value: it holds a password.
  if (typeof value !== "string" || !isPostgresUrl(value))
    throw invalidConfig(
      source,
      `"${CONFIG_KEY.DATABASE_URL}" must be a postgres:// or postgresql:// URL.`,
    );
  // The setup wizard only prepares a DuckDB file, so it would finish on a
  // database the next start no longer opens.
  if (firstRun)
    throw invalidConfig(
      source,
      `"${CONFIG_KEY.DATABASE_URL}" needs a finished setup. Remove it or set "${CONFIG_KEY.FIRST_RUN} = false".`,
    );
  return { databaseUrl: value };
}

/**
 * Reads the Pages settings from a parsed configuration file.
 *
 * @param table - Parsed TOML document.
 * @param source - Path of the file, named in error messages.
 * @returns The configuration; missing keys take their defaults.
 * @throws {ConfigError} When a key holds a value of the wrong kind, or when
 * a finished setup does not name its database.
 */
export function readPagesConfig(table: TomlTable, source: string): PagesConfig {
  const acpResources = readAcpResourceSettings(table);
  const mcpHttp = readMcpHttpConfig(table);
  const firstRun = readFirstRun(table, source);
  const port = readPort(table, source);
  const databasePath = readDatabasePath(table, source);
  const databaseUrl = readDatabaseUrl(table, source, firstRun);
  const logging = readLoggingConfig(table, source);
  const interpreters = readInterpreterConfig(table, source);
  const proxies = readProxyConfig(table, source);
  const picaBrowser = readPicaBrowserConfig(table, source);
  const picaMobile = readPicaMobileConfig(table, source);
  const gitBridges = readGitBridgeConfig(table, source);

  if (firstRun) {
    return {
      ...acpResources,
      ...gitBridges,
      ...mcpHttp,
      ...picaMobile,
      ...logging,
      ...interpreters,
      ...proxies,
      ...picaBrowser,
      databasePath,
      firstRun,
      port,
    };
  }

  if (databasePath === null) {
    throw invalidConfig(
      source,
      `"${CONFIG_KEY.FIRST_RUN}" is false, but "${CONFIG_KEY.DATABASE_PATH}" is missing. Set "${CONFIG_KEY.DATABASE_PATH}" to the Pages database, or set "${CONFIG_KEY.FIRST_RUN} = true" to run the setup again.`,
    );
  }

  return {
    ...acpResources,
    ...gitBridges,
    ...mcpHttp,
    ...picaMobile,
    ...logging,
    ...interpreters,
    ...proxies,
    ...picaBrowser,
    ...databaseUrl,
    databasePath,
    firstRun,
    port,
  };
}

function readGitBridgeConfig(
  table: TomlTable,
  source: string,
): Pick<BaseConfig, "agentGitBridges"> {
  try {
    const agentGitBridges = readAgentGitBridges(table);
    return agentGitBridges.length > 0 ? { agentGitBridges } : {};
  } catch (caughtError: unknown) {
    logCaughtError("PagesConfig", caughtError);

    throw invalidConfig(
      source,
      caughtError instanceof Error
        ? caughtError.message
        : '"agentGitBridges" is invalid.',
    );
  }
}

function isBrowserOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

function readPicaBrowserConfig(
  table: TomlTable,
  source: string,
): Pick<BaseConfig, "picaBrowserLocalOrigins"> {
  const entries = table.picaBrowserLocalOrigins;
  if (entries === undefined) return {};
  if (!Array.isArray(entries) || !entries.every(isBrowserOrigin))
    throw invalidConfig(
      source,
      '"picaBrowserLocalOrigins" must be a list of origins such as "http://127.0.0.1:8080" (scheme, host and port, no path).',
    );
  return { picaBrowserLocalOrigins: entries };
}

function isTrustedProxyList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "string" && parseTrustedProxyEntry(entry) !== null,
    )
  );
}

function readPicaMobileConfig(
  table: TomlTable,
  source: string,
): Pick<
  BaseConfig,
  | "picaMobilePort"
  | "picaMobileFcmServiceAccountFile"
  | "picaMobileReplayTtlSeconds"
> {
  const port = table.picaMobilePort;
  const keyFile = table.picaMobileFcmServiceAccountFile;
  const replayTtl = table.picaMobileReplayTtlSeconds;
  if (port !== undefined && !isValidPort(port))
    throw invalidConfig(
      source,
      `"picaMobilePort" must be a whole number from 1 to ${HIGHEST_PORT}.`,
    );
  if (
    keyFile !== undefined &&
    (typeof keyFile !== "string" || !path.isAbsolute(keyFile))
  )
    throw invalidConfig(
      source,
      '"picaMobileFcmServiceAccountFile" must be an absolute file path.',
    );
  if (replayTtl !== undefined && !isReplayTtlSeconds(replayTtl))
    throw invalidConfig(
      source,
      '"picaMobileReplayTtlSeconds" must be a whole number from 60 to 3600.',
    );
  return {
    ...(port === undefined ? {} : { picaMobilePort: port }),
    ...(keyFile === undefined
      ? {}
      : { picaMobileFcmServiceAccountFile: path.normalize(keyFile) }),
    ...(replayTtl === undefined
      ? {}
      : { picaMobileReplayTtlSeconds: replayTtl }),
  };
}

function isReplayTtlSeconds(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= PICA_MOBILE_REPLAY_TTL_RANGE_SECONDS.minimum &&
    value <= PICA_MOBILE_REPLAY_TTL_RANGE_SECONDS.maximum
  );
}

function readProxyConfig(
  table: TomlTable,
  source: string,
): Pick<BaseConfig, "trustedProxies"> {
  const entries = table.trustedProxies;
  if (entries === undefined) return {};
  if (!isTrustedProxyList(entries))
    throw invalidConfig(
      source,
      '"trustedProxies" must be a list of IP addresses or ranges such as "127.0.0.1" or "10.0.0.0/8"; a range must not be /0.',
    );
  return { trustedProxies: entries };
}

function readInterpreterConfig(
  table: TomlTable,
  source: string,
): Pick<BaseConfig, "interpreterProfiles"> {
  if (table.interpreterProfiles === undefined) return {};
  const parsed = interpreterProfilesSchema.safeParse(table.interpreterProfiles);
  if (!parsed.success)
    throw invalidConfig(source, "Invalid interpreter profiles.");
  return { interpreterProfiles: parsed.data };
}

function readLoggingConfig(
  table: TomlTable,
  source: string,
): Pick<BaseConfig, "logRetentionDays"> {
  const days = table.logRetentionDays;
  if (days === undefined) return {};
  if (!isLogRetentionDays(days))
    throw invalidConfig(
      source,
      '"logRetentionDays" must be a whole number from 0 to 365.',
    );
  return { logRetentionDays: days };
}

/**
 * Writes the Pages settings into a parsed configuration file.
 *
 * @param table - Parsed TOML document whose other keys are kept.
 * @param config - Settings to store.
 * @returns A new document; keys keep their position.
 */
export function writePagesConfig(
  table: TomlTable,
  config: PagesConfig,
): TomlTable {
  const document: TomlTable = {
    ...table,
    [CONFIG_KEY.FIRST_RUN]: config.firstRun,
    [CONFIG_KEY.PORT]: config.port,
  };
  if (config.listenAddress !== undefined)
    document.listenAddress = config.listenAddress;
  if (config.mcpHttp !== undefined) document.mcpHttp = { ...config.mcpHttp };
  if (config.picaMobilePort !== undefined)
    document.picaMobilePort = config.picaMobilePort;
  if (config.picaMobileFcmServiceAccountFile !== undefined)
    document.picaMobileFcmServiceAccountFile =
      config.picaMobileFcmServiceAccountFile;
  if (config.picaMobileReplayTtlSeconds !== undefined)
    document.picaMobileReplayTtlSeconds = config.picaMobileReplayTtlSeconds;
  if (config.interpreterProfiles !== undefined)
    document.interpreterProfiles = config.interpreterProfiles.map(
      (profile) => ({ ...profile }),
    );
  if (config.logRetentionDays !== undefined)
    document.logRetentionDays = config.logRetentionDays;
  if (config.trustedProxies !== undefined)
    document.trustedProxies = [...config.trustedProxies];
  if (config.picaBrowserLocalOrigins !== undefined)
    document.picaBrowserLocalOrigins = [...config.picaBrowserLocalOrigins];

  const resourceKeys = [
    "maxConcurrentAcpSessions",
    "memoryAwareScheduling",
    "minimumAvailableMemory",
    "queueDiscipline",
  ] as const;
  for (const key of resourceKeys) {
    const setting = config[key];
    if (setting !== undefined) document[key] = setting;
  }

  if (!config.firstRun && config.databaseUrl !== undefined)
    document[CONFIG_KEY.DATABASE_URL] = config.databaseUrl;

  if (config.databasePath === null) {
    delete document[CONFIG_KEY.DATABASE_PATH];
  } else {
    document[CONFIG_KEY.DATABASE_PATH] = config.databasePath;
  }

  return document;
}

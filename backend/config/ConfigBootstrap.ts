import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

import { inspectPagesDatabase } from "@/backend/database/PagesDatabaseInspector";

import {
  ConfigError,
  DEFAULT_CONFIG,
  resolveDefaultDataDirectory,
  resolveDefaultDatabasePath,
} from "./PagesConfig";

import type { ConfigFile } from "./ConfigFile";
import type { PagesConfig } from "./PagesConfig";

const PRIVATE_DIRECTORY_MODE = 0o700;

/** What the start-up found and changed in the configuration. */
export interface ConfigBootstrapResult {
  /** The configuration as stored in the file. */
  readonly config: PagesConfig;
  /** Whether the file did not exist and was written now. */
  readonly isNewConfig: boolean;
}

/**
 * Builds the first configuration of an installation without one.
 *
 * @remarks
 * Installations from before the setup wizard keep their database at the
 * default path and have no configuration file. They must not run the setup
 * again, so such a database with an active administrator is adopted as a
 * finished setup.
 */
async function createInitialConfig(configPath: string): Promise<PagesConfig> {
  const databasePath = resolveDefaultDatabasePath(configPath);

  if (!existsSync(databasePath)) {
    return DEFAULT_CONFIG;
  }

  const inspection = await inspectPagesDatabase(databasePath);

  if (inspection.kind === "pages" && inspection.hasActiveAdministrator) {
    return { databasePath, firstRun: false, port: DEFAULT_CONFIG.port };
  }

  return DEFAULT_CONFIG;
}

/**
 * Prepares what a configuration needs before the server starts.
 *
 * @remarks
 * While the setup is pending, the default data directory next to the
 * configuration is created empty, so the suggested database path is
 * writable. No database file is created before the setup finishes.
 */
async function prepareConfig(
  configFile: ConfigFile,
  config: PagesConfig,
): Promise<void> {
  if (config.firstRun) {
    await mkdir(resolveDefaultDataDirectory(configFile.path), {
      mode: PRIVATE_DIRECTORY_MODE,
      recursive: true,
    });

    return;
  }

  if (!existsSync(config.databasePath)) {
    throw new ConfigError(
      `The database "${config.databasePath}" named in "${configFile.path}" does not exist. Restore it, correct "databasePath", or set "firstRun = true" to run the setup again.`,
    );
  }
}

/**
 * Reads the configuration at start-up and creates it when it is missing.
 *
 * @param configFile - Configuration file of the instance.
 * @returns The stored configuration.
 * @throws {ConfigError} When the file is invalid, or when a finished setup
 * names a database file that does not exist.
 */
export async function bootstrapConfig(
  configFile: ConfigFile,
): Promise<ConfigBootstrapResult> {
  const storedConfig = await configFile.read();

  if (storedConfig !== null) {
    await prepareConfig(configFile, storedConfig);

    return { config: storedConfig, isNewConfig: false };
  }

  const config = await createInitialConfig(configFile.path);

  await configFile.write(config);
  await prepareConfig(configFile, config);

  return { config, isNewConfig: true };
}

import { bootstrapConfig } from "@/backend/config/ConfigBootstrap";
import { ConfigFile } from "@/backend/config/ConfigFile";
import { resolveDefaultDatabasePath } from "@/backend/config/PagesConfig";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { createLegacyDatabaseWarning } from "@/backend/database/DatabasePath";

import { SetupToken } from "./SetupToken";

import type {
  CompletedSetupConfig,
  PagesConfig,
} from "@/backend/config/PagesConfig";

declare global {
  var pagesRuntime: Promise<PagesRuntime> | undefined;
}

/** Raised when code needs the database while the setup is still pending. */
export class SetupPendingError extends Error {
  public constructor() {
    super("Pages is not set up yet. Finish the setup wizard first.");
    this.name = "SetupPendingError";
  }
}

/** Raised when a request arrives before the server initialized the runtime. */
export class RuntimeNotInitializedError extends Error {
  public constructor() {
    super(
      "The Pages runtime was not initialized. Start Pages with `pnpm start` or `pnpm dev`.",
    );
    this.name = "RuntimeNotInitializedError";
  }
}

/**
 * The state of the running Pages process: its configuration and, while the
 * setup is pending, the one-time setup token.
 */
export class PagesRuntime {
  private readonly file: ConfigFile;
  private readonly setupQueue = new SerialQueue();
  private config: PagesConfig;
  private setupToken: SetupToken | null;

  /**
   * Creates the runtime state.
   *
   * @param file - Configuration file of the instance.
   * @param config - Configuration as stored in the file.
   */
  public constructor(file: ConfigFile, config: PagesConfig) {
    this.file = file;
    this.config = config;
    this.setupToken = config.firstRun ? SetupToken.create() : null;
  }

  /** Configuration file of the instance. */
  public get configFile(): ConfigFile {
    return this.file;
  }

  /** Returns the configuration as currently stored. */
  public getConfig(): PagesConfig {
    return this.config;
  }

  /** Returns whether the setup wizard is available. */
  public isSetupPending(): boolean {
    return this.config.firstRun;
  }

  /**
   * Returns the setup token for the operator console.
   *
   * @returns The secret, or `null` when no setup is pending.
   */
  public getSetupToken(): string | null {
    return this.setupToken?.value ?? null;
  }

  /**
   * Checks a submitted setup token.
   *
   * @param candidate - Untrusted value from a request.
   * @returns Whether a setup is pending and the value is its token.
   */
  public verifySetupToken(candidate: unknown): boolean {
    return this.setupToken?.matches(candidate) ?? false;
  }

  /**
   * Returns the database path the wizard suggests.
   *
   * @returns The database of a reset instance, else the default path.
   */
  public getSuggestedDatabasePath(): string {
    return (
      this.config.databasePath ?? resolveDefaultDatabasePath(this.file.path)
    );
  }

  /**
   * Returns the database of the finished setup.
   *
   * @throws {SetupPendingError} While the setup is pending.
   */
  public getDatabasePath(): string {
    if (this.config.firstRun) {
      throw new SetupPendingError();
    }

    return this.config.databasePath;
  }

  /**
   * Runs a setup completion while no other one runs.
   *
   * @param work - Completion steps.
   * @returns What `work` returns.
   */
  public runExclusiveSetup<Result>(
    work: () => Promise<Result>,
  ): Promise<Result> {
    return this.setupQueue.run(work);
  }

  /**
   * Switches the process to normal operation after a finished setup.
   *
   * @param config - Configuration that was stored for the finished setup.
   *
   * @remarks
   * The setup token is discarded, so it cannot be used again.
   */
  public finishSetup(config: CompletedSetupConfig): void {
    this.config = config;
    this.setupToken = null;
  }
}

async function createRuntime(configPath: string): Promise<PagesRuntime> {
  const configFile = new ConfigFile(configPath);
  const { config } = await bootstrapConfig(configFile);
  const runtime = new PagesRuntime(configFile, config);

  if (runtime.isSetupPending()) {
    const legacyWarning = createLegacyDatabaseWarning(
      runtime.getSuggestedDatabasePath(),
    );

    if (legacyWarning) {
      console.warn(legacyWarning);
    }
  }

  return runtime;
}

/**
 * Reads the configuration and creates the runtime state of the process.
 *
 * @param configPath - Absolute path of the configuration file.
 * @returns The runtime; later calls return the first one.
 * @throws {ConfigError} When the configuration cannot be used.
 */
export function initializePagesRuntime(
  configPath: string,
): Promise<PagesRuntime> {
  globalThis.pagesRuntime ??= createRuntime(configPath).catch(
    (error: unknown) => {
      // Keep no failed start, so a corrected configuration can be retried.
      globalThis.pagesRuntime = undefined;

      throw error;
    },
  );

  return globalThis.pagesRuntime;
}

/**
 * Returns the runtime state of the process.
 *
 * @throws {RuntimeNotInitializedError} When the server did not initialize it.
 */
export async function getPagesRuntime(): Promise<PagesRuntime> {
  if (globalThis.pagesRuntime === undefined) {
    throw new RuntimeNotInitializedError();
  }

  return globalThis.pagesRuntime;
}

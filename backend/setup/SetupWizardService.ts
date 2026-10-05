import { randomBytes } from "node:crypto";
import { constants as fsConstants, existsSync } from "node:fs";
import { copyFile, link, rm } from "node:fs/promises";
import path from "node:path";

import { Database } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import {
  canUseDatabaseLocation,
  DATABASE_LOCATION_STATUS,
} from "@/definition/Setup";

import { checkDatabaseLocation } from "./DatabaseLocation";
import { SetupDatabaseWriter } from "./SetupDatabaseWriter";

import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type { CompletedSetupConfig } from "@/backend/config/PagesConfig";
import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";
import type { DatabaseLocationStatus } from "@/definition/Setup";
import type { Language } from "@/language/Language";
import type { DatabaseLocationCheck } from "./DatabaseLocation";
import type { SetupWriteResult } from "./SetupDatabaseWriter";

/** Validated wizard input of a setup. */
export interface SetupInput {
  readonly companyName: string;
  readonly username: string;
  readonly password: string;
  readonly email: string | null;
  /** Database path as entered; it is checked again before use. */
  readonly databasePath: string;
  readonly language: Language;
  readonly userAgent: string | null;
}

/** Outcome of finishing the setup. */
export type SetupCompletionResult =
  | {
      readonly status: "completed";
      /** Session token of the administrator, for the browser cookie only. */
      readonly sessionToken: string;
    }
  | { readonly status: "alreadyCompleted" }
  | { readonly status: "invalidToken" }
  | {
      readonly status: "databaseLocation";
      readonly location: DatabaseLocationStatus;
    }
  | { readonly status: "usernameTaken" }
  | { readonly status: "emailTaken" }
  | { readonly status: "failed" };

/** Starts the application services on the database of the finished setup. */
export type ServiceActivation = (
  database: Database,
  databasePath: string,
) => Promise<unknown>;

/** Collaborators of the setup wizard, replaceable in tests. */
export interface SetupWizardDependencies {
  readonly runtime: PagesRuntime;
  readonly passwordHasher: PasswordHasher;
  readonly activateServices: ServiceActivation;
  readonly checkLocation?: (input: string) => Promise<DatabaseLocationCheck>;
  readonly openDatabase?: (databasePath: string) => Promise<Database>;
}

/** A database that holds the written setup, still open. */
interface PreparedDatabase {
  readonly database: Database;
  readonly sessionToken: string;
}

type PreparationResult =
  | { readonly status: "prepared"; readonly prepared: PreparedDatabase }
  | Exclude<SetupWriteResult, { readonly status: "written" }>
  | {
      readonly status: "databaseLocation";
      readonly location: DatabaseLocationStatus;
    };

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

/** Hidden file next to the target that holds a new database until it is complete. */
function createStagingPath(databasePath: string): string {
  return path.join(
    path.dirname(databasePath),
    `.${path.basename(databasePath)}.setup-${randomBytes(6).toString("hex")}`,
  );
}

async function removeDatabaseFiles(databasePath: string): Promise<void> {
  await rm(databasePath, { force: true });
  await rm(`${databasePath}.wal`, { force: true });
}

/**
 * Finishes the setup wizard: stores company, main administrator, database
 * location, and configuration, then switches the process to normal
 * operation.
 *
 * @remarks
 * Completions run one at a time and check the token again once it is their
 * turn, so a second request can never create a second administrator. Until
 * the configuration is stored, `firstRun` stays `true` and the token stays
 * valid, so a failed attempt can be repeated. A new database only appears
 * at its path once it is complete, and an existing file is never replaced.
 */
export class SetupWizardService {
  private readonly runtime: PagesRuntime;
  private readonly passwordHasher: PasswordHasher;
  private readonly activateServices: ServiceActivation;
  private readonly checkLocation: (
    input: string,
  ) => Promise<DatabaseLocationCheck>;
  private readonly openDatabase: (databasePath: string) => Promise<Database>;

  /**
   * Creates the setup wizard service.
   *
   * @param dependencies - Runtime, hashing, and service activation.
   */
  public constructor(dependencies: SetupWizardDependencies) {
    this.runtime = dependencies.runtime;
    this.passwordHasher = dependencies.passwordHasher;
    this.activateServices = dependencies.activateServices;
    this.checkLocation = dependencies.checkLocation ?? checkDatabaseLocation;
    this.openDatabase =
      dependencies.openDatabase ??
      ((databasePath) => Database.create(databasePath));
  }

  /**
   * Finishes the setup.
   *
   * @param input - Validated wizard input.
   * @param token - Setup token submitted with the request.
   * @returns `completed` with the administrator's session, or the reason
   * the setup did not finish.
   */
  public complete(
    input: SetupInput,
    token: unknown,
  ): Promise<SetupCompletionResult> {
    return this.runtime.runExclusiveSetup(async () => {
      if (!this.runtime.isSetupPending()) {
        return { status: "alreadyCompleted" };
      }

      if (!this.runtime.verifySetupToken(token)) {
        return { status: "invalidToken" };
      }

      try {
        return await this.completePendingSetup(input);
      } catch (error: unknown) {
        console.error("[pages] The setup could not be finished.", error);

        return { status: "failed" };
      }
    });
  }

  private async completePendingSetup(
    input: SetupInput,
  ): Promise<SetupCompletionResult> {
    const location = await this.checkLocation(input.databasePath);

    if (
      location.databasePath === null ||
      !canUseDatabaseLocation(location.status)
    ) {
      return { location: location.status, status: "databaseLocation" };
    }

    const passwordHash = await this.passwordHasher.hash(input.password);
    const record = {
      companyName: input.companyName,
      email: input.email,
      language: input.language,
      passwordHash,
      userAgent: input.userAgent,
      username: input.username,
    };
    const preparation =
      location.status === DATABASE_LOCATION_STATUS.EXISTING
        ? await this.prepareExistingDatabase(location.databasePath, record)
        : await this.prepareNewDatabase(location.databasePath, record);

    if (preparation.status !== "prepared") {
      return preparation;
    }

    return this.finish(location.databasePath, preparation.prepared);
  }

  private async finish(
    databasePath: string,
    prepared: PreparedDatabase,
  ): Promise<SetupCompletionResult> {
    let config: CompletedSetupConfig;

    try {
      const stored = await this.runtime.configFile.update((current) => ({
        databasePath,
        firstRun: false,
        port: current.port,
      }));

      config = { databasePath, firstRun: false, port: stored.port };
    } catch (error: unknown) {
      await prepared.database.close();

      throw error;
    }

    this.runtime.finishSetup(config);

    try {
      await this.activateServices(prepared.database, databasePath);
    } catch (error: unknown) {
      // The setup is stored; a restart opens the database normally.
      console.error("[pages] The services could not be started.", error);
    }

    return { sessionToken: prepared.sessionToken, status: "completed" };
  }

  private async prepareExistingDatabase(
    databasePath: string,
    record: Parameters<SetupDatabaseWriter["write"]>[0],
  ): Promise<PreparationResult> {
    const database = await this.openDatabase(databasePath);

    try {
      await database.migrate(DATABASE_MIGRATIONS);

      const written = await new SetupDatabaseWriter(database).write(record);

      if (written.status !== "written") {
        await database.close();

        return written;
      }

      return {
        prepared: { database, sessionToken: written.sessionToken },
        status: "prepared",
      };
    } catch (error: unknown) {
      await database.close();

      throw error;
    }
  }

  private async prepareNewDatabase(
    databasePath: string,
    record: Parameters<SetupDatabaseWriter["write"]>[0],
  ): Promise<PreparationResult> {
    const stagingPath = createStagingPath(databasePath);

    try {
      const written = await this.writeStagingDatabase(stagingPath, record);

      if (written.status !== "written") {
        return written;
      }

      if (!(await this.publishStagingDatabase(stagingPath, databasePath))) {
        return {
          location: DATABASE_LOCATION_STATUS.FOREIGN,
          status: "databaseLocation",
        };
      }

      return {
        prepared: {
          database: await this.openDatabase(databasePath),
          sessionToken: written.sessionToken,
        },
        status: "prepared",
      };
    } finally {
      await removeDatabaseFiles(stagingPath);
    }
  }

  private async writeStagingDatabase(
    stagingPath: string,
    record: Parameters<SetupDatabaseWriter["write"]>[0],
  ): Promise<SetupWriteResult> {
    const database = await this.openDatabase(stagingPath);

    try {
      await database.migrate(DATABASE_MIGRATIONS);

      return await new SetupDatabaseWriter(database).write(record);
    } finally {
      await database.close();
    }
  }

  /**
   * Moves the complete staging database to its final name.
   *
   * @returns `false` when a file appeared at the target meanwhile; it is
   * left untouched.
   */
  private async publishStagingDatabase(
    stagingPath: string,
    databasePath: string,
  ): Promise<boolean> {
    if (existsSync(`${stagingPath}.wal`)) {
      throw new Error("The new database kept unwritten changes after closing.");
    }

    try {
      // A hard link never replaces an existing file, unlike a rename.
      await link(stagingPath, databasePath);
    } catch (error: unknown) {
      if (isFileExistsError(error)) {
        return false;
      }

      return this.copyWithoutReplacing(stagingPath, databasePath);
    }

    return true;
  }

  /** Fallback for file systems without hard links. */
  private async copyWithoutReplacing(
    stagingPath: string,
    databasePath: string,
  ): Promise<boolean> {
    try {
      await copyFile(stagingPath, databasePath, fsConstants.COPYFILE_EXCL);

      return true;
    } catch (error: unknown) {
      if (isFileExistsError(error)) {
        return false;
      }

      // The exclusive copy created the file, so a partial copy is ours.
      await rm(databasePath, { force: true });

      throw error;
    }
  }
}

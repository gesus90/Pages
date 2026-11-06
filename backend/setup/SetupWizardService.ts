import path from "node:path";

import { Database } from "@/backend/database/Database";
import { POSTGRES_MIGRATIONS } from "@/backend/database/Migrations";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";
import { DATABASE_LOCATION_STATUS } from "@/definition/Setup";
import { registerLogSecret } from "@/backend/logging/LogRedaction";

import { isSetupDatabaseUrl } from "./SetupConnection";
import {
  createSetupIntent,
  readSetupIntent,
  retireSetupIntent,
  setupFingerprint,
} from "./SetupIntent";
import {
  hasCommittedSetup,
  initializeSetupDatabase,
  renewSetupSession,
  SetupDatabaseNotEmptyError,
} from "./SetupPostgresRepository";

import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";
import type { DatabaseLocationStatus } from "@/definition/Setup";
import type { Language } from "@/language/Language";

/** Validated wizard input of a setup. */
export interface SetupInput {
  readonly companyName: string;
  readonly username: string;
  readonly password: string;
  readonly email: string | null;
  /** PostgreSQL connection supplied by the operator. */
  readonly databaseUrl: string;
  readonly language: Language;
  readonly userAgent: string | null;
}

/** Outcome of finishing the setup. */
export type SetupCompletionResult =
  | { readonly status: "completed"; readonly sessionToken: string }
  | {
      readonly status:
        | "alreadyCompleted"
        | "invalidToken"
        | "usernameTaken"
        | "emailTaken"
        | "failed";
    }
  | {
      readonly status: "databaseLocation";
      readonly location: DatabaseLocationStatus;
    };

/** Starts application services on the configured database. */
export type ServiceActivation = (
  database: Database,
  databasePath: string,
) => Promise<unknown>;

/** Collaborators of the setup wizard. */
export interface SetupWizardDependencies {
  readonly runtime: PagesRuntime;
  readonly passwordHasher: PasswordHasher;
  readonly activateServices: ServiceActivation;
}

/** Completes a token-authorized setup against an empty PostgreSQL database. */
export class SetupWizardService {
  private readonly runtime: PagesRuntime;
  private readonly passwordHasher: PasswordHasher;
  private readonly activateServices: ServiceActivation;

  /** Creates the wizard service. */
  public constructor(dependencies: SetupWizardDependencies) {
    this.runtime = dependencies.runtime;
    this.passwordHasher = dependencies.passwordHasher;
    this.activateServices = dependencies.activateServices;
  }

  /** Completes setup once after checking the current token. */
  public complete(
    input: SetupInput,
    token: unknown,
  ): Promise<SetupCompletionResult> {
    return this.runtime.runExclusiveSetup(async () => {
      if (!this.runtime.isSetupPending()) return { status: "alreadyCompleted" };
      if (!this.runtime.verifySetupToken(token))
        return { status: "invalidToken" };
      if (!isSetupDatabaseUrl(input.databaseUrl))
        return {
          status: "databaseLocation",
          location: DATABASE_LOCATION_STATUS.INVALID,
        };
      try {
        return await this.finish(input);
      } catch (error: unknown) {
        if (error instanceof SetupDatabaseNotEmptyError)
          return {
            status: "databaseLocation",
            location: DATABASE_LOCATION_STATUS.FOREIGN,
          };
        logCaughtError("SetupWizardService", error);
        logDiagnostic(
          "SetupWizardService",
          "error",
          "[pages] The setup could not be finished.",
          error,
        );
        return { status: "failed" };
      }
    });
  }

  private async initializeDatabase(
    database: Database,
    input: SetupInput,
    sessionToken: string,
    isNewIntent: boolean,
  ): Promise<string> {
    try {
      return await initializeSetupDatabase(
        database,
        POSTGRES_MIGRATIONS,
        {
          companyName: input.companyName,
          username: input.username,
          email: input.email,
          passwordHash: await this.passwordHasher.hash(input.password),
          language: input.language,
          userAgent: input.userAgent,
        },
        sessionToken,
      );
    } catch (error: unknown) {
      if (isNewIntent && error instanceof SetupDatabaseNotEmptyError)
        await retireSetupIntent(this.runtime.configFile.path);
      throw error;
    }
  }

  private async finish(input: SetupInput): Promise<SetupCompletionResult> {
    const setupValues = JSON.stringify([
      input.companyName,
      input.username,
      input.password,
      input.email,
      input.language,
    ]);
    const existing = await readSetupIntent(this.runtime.configFile.path);
    if (
      existing &&
      (existing.databaseUrl !== input.databaseUrl ||
        existing.fingerprint !==
          setupFingerprint(existing.sessionToken, setupValues))
    )
      throw new Error("A different setup attempt is pending.");
    const database = await Database.connect(
      input.databaseUrl,
      path.dirname(this.runtime.getSuggestedDatabasePath()),
    );
    let activated = false;
    try {
      const intent =
        existing ??
        (await createSetupIntent(
          this.runtime.configFile.path,
          input.databaseUrl,
          setupValues,
        ));
      registerLogSecret(intent.sessionToken);
      const committed = await hasCommittedSetup(database, intent.sessionToken);
      let sessionToken = intent.sessionToken;
      if (committed) await renewSetupSession(database, sessionToken);
      if (!committed) {
        sessionToken = await this.initializeDatabase(
          database,
          input,
          intent.sessionToken,
          existing === null,
        );
      }
      const databasePath = this.runtime.getSuggestedDatabasePath();
      const previous = this.runtime.getConfig();
      const config = await this.runtime.configFile.update((current) => ({
        ...current,
        databasePath,
        databaseUrl: input.databaseUrl,
        firstRun: false,
      }));
      if (config.firstRun)
        throw new Error("Setup configuration was not completed.");
      this.runtime.stageSetup(config);
      try {
        await this.activateServices(database, databasePath);
      } catch (error: unknown) {
        this.runtime.stageSetup(previous);
        await this.runtime.configFile.write(previous);
        throw error;
      }
      activated = true;
      this.runtime.finishSetup(config);
      try {
        await retireSetupIntent(this.runtime.configFile.path);
      } catch (error: unknown) {
        logCaughtError("SetupWizardService", error);
        logDiagnostic(
          "SetupWizardService",
          "error",
          "[pages] The completed setup intent could not be retired.",
        );
      }
      return { status: "completed", sessionToken };
    } finally {
      if (!activated) await database.close();
    }
  }
}

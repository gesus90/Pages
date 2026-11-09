import {
  GOOGLE_DRIVE_TREE_SCOPES,
  GOOGLE_DRIVE_WRITE_SCOPES,
} from "@/backend/google/GoogleDriveConfig";
import { GOOGLE_DRIVE_CALLBACK_PATH } from "@/backend/service/google/GoogleDriveConnectionService";

import type { GoogleDriveApiClient } from "@/backend/google/GoogleDriveApiClient";
import type {
  GoogleDriveAccess,
  GoogleDriveConnection,
  GoogleDriveOrigins,
} from "@/backend/service/google/GoogleDriveConnectionService";
import type {
  GoogleDriveCallbackOutcome,
  GoogleDriveStatus,
} from "@/definition/GoogleDrive";

/** The stand-in token of the simulation; it opens nothing at Google. */
const SIMULATED_ACCESS_TOKEN = "simulated-access-token";

/** What the simulated connection needs. */
export interface GoogleDriveSimulatedConnectionDependencies {
  /** A client whose `fetch` is the simulation, for the account check. */
  readonly client: Pick<GoogleDriveApiClient, "readAccount">;
  /** The scopes the scenario grants. */
  readonly grantedScopes: readonly string[];
}

/**
 * The connection of a development server with the simulated Drive (PAGE-270).
 *
 * @remarks
 * It counts as connected without any sign-in: there is no OAuth flow, no
 * stored or real credential and no request to Google. Like the real
 * connection it proves itself on every call with `about.get`, here answered
 * by the simulation, so the `unreachable` scenario shows up as an unusable
 * connection.
 */
export class GoogleDriveSimulatedConnection implements GoogleDriveConnection {
  private readonly client: GoogleDriveSimulatedConnectionDependencies["client"];
  private readonly grantedScopes: readonly string[];

  /**
   * Creates the simulated connection.
   *
   * @param dependencies - The account check and the granted scopes.
   */
  public constructor(dependencies: GoogleDriveSimulatedConnectionDependencies) {
    this.client = dependencies.client;
    this.grantedScopes = dependencies.grantedScopes;
  }

  /**
   * Starts no sign-in: the simulation has no OAuth flow.
   *
   * @returns Always `null`.
   */
  public async start(): Promise<string | null> {
    return Promise.resolve(null);
  }

  /**
   * Finishes no sign-in: the simulation has no OAuth flow.
   *
   * @returns Always `invalid`.
   */
  public async complete(): Promise<GoogleDriveCallbackOutcome> {
    return Promise.resolve("invalid");
  }

  /**
   * Tells where the simulated connection stands.
   *
   * @param origins - The allowed origins, for the redirect URIs of the card.
   * @returns `connected` while the simulation answers, marked as simulation.
   */
  public async getStatus(
    origins: GoogleDriveOrigins,
  ): Promise<GoogleDriveStatus> {
    const access = await this.access();

    return {
      accountEmail: access.ok ? access.accountEmail : null,
      canSignIn: false,
      isSimulation: true,
      missingSettings: [],
      needsFolderAccess: !this.grantedScopes.some((scope) =>
        GOOGLE_DRIVE_TREE_SCOPES.includes(scope),
      ),
      needsWriteAccess: !this.grantedScopes.some((scope) =>
        GOOGLE_DRIVE_WRITE_SCOPES.includes(scope),
      ),
      problem: access.ok ? null : access.problem,
      redirectUris: origins.allowed.map(
        (origin) => `${origin}${GOOGLE_DRIVE_CALLBACK_PATH}`,
      ),
      state: access.ok ? "connected" : access.state,
    };
  }

  /**
   * Provides the simulated access after the simulation answered `about.get`.
   *
   * @returns The stand-in token, or `unavailable` when the simulation does not answer.
   */
  public async access(): Promise<GoogleDriveAccess> {
    const account = await this.client.readAccount(SIMULATED_ACCESS_TOKEN);

    if (!account.ok) {
      return { ok: false, problem: account.problem, state: "unavailable" };
    }

    return {
      accessToken: SIMULATED_ACCESS_TOKEN,
      accountEmail: account.value.emailAddress,
      grantedScopes: this.grantedScopes,
      ok: true,
      permissionId: account.value.permissionId,
    };
  }
}

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { buildGoogleAuthorizationUrl } from "@/backend/google/GoogleDriveApiClient";
import { GOOGLE_DRIVE_SCOPE } from "@/backend/google/GoogleDriveConfig";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import type {
  GoogleCallResult,
  GoogleDriveAccount,
  GoogleDriveApiClient,
} from "@/backend/google/GoogleDriveApiClient";
import type { GoogleOAuthApplication } from "@/backend/google/GoogleDriveConfig";
import type {
  GoogleDriveReauthorizationReason,
  GoogleDriveRepository,
  GoogleDriveSignInAttempt,
  StoredGoogleDriveConnection,
} from "@/backend/database/repositories/google/GoogleDriveRepository";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type {
  GoogleDriveCallbackOutcome,
  GoogleDriveConnectionState,
  GoogleDriveProblem,
  GoogleDriveStatus,
} from "@/definition/GoogleDrive";

/** Where Google sends the browser after the sign-in, relative to the public address. */
export const GOOGLE_DRIVE_CALLBACK_PATH = "/settings-api/google-drive/callback";

/** How long a sign-in attempt lives; it covers the account choice, 2FA and the consent. */
const ATTEMPT_LIFETIME_MS = 15 * 60 * 1000;

/** An access token is renewed this long before Google stops accepting it. */
const RENEWAL_MARGIN_MS = 60 * 1000;

const MAXIMUM_STATE_LENGTH = 200;
const MAXIMUM_CODE_LENGTH = 2048;
const COMPONENT = "GoogleDriveConnectionService";

/** The problems that only a new sign-in repairs; they are stored with the connection. */
const REAUTHORIZATION_PROBLEMS: readonly GoogleDriveReauthorizationReason[] = [
  "access_revoked",
  "scope_missing",
  "account_changed",
  "secret_unavailable",
];

/** The query parameters of the callback; every one comes from an untrusted browser. */
export interface GoogleDriveCallbackInput {
  /** The allowed origin the callback came in on, `null` for any other one. */
  readonly baseUrl: string | null;
  readonly state: string | null;
  readonly code: string | null;
  readonly error: string | null;
}

/** The allowed origins of the instance and the one a request came in on. */
export interface GoogleDriveOrigins {
  readonly allowed: readonly string[];
  readonly current: string | null;
}

/** The OAuth client of the instance and a client that speaks for it. */
export interface GoogleDriveRuntime {
  readonly application: Pick<GoogleOAuthApplication, "clientId">;
  readonly client: Pick<
    GoogleDriveApiClient,
    "exchangeCode" | "refresh" | "readAccount"
  >;
}

/** Collaborators of the connection service. */
export interface GoogleDriveConnectionDependencies {
  readonly repository: GoogleDriveRepository;
  readonly cipher: InstanceSecretCipher;
  /** `null` while the instance has no OAuth client. */
  readonly runtime: GoogleDriveRuntime | null;
  /** Names of the settings that are missing, for the status. */
  readonly missingSettings: readonly string[];
  readonly now?: () => number;
}

/**
 * A usable connection for one server-side Drive request, or why there is none.
 *
 * @remarks
 * The access token is a secret: it stays in the server process, goes only
 * into the `Authorization` header of a Drive request and never into an
 * answer, an address or a log.
 */
export type GoogleDriveAccess =
  | {
      readonly ok: true;
      readonly accessToken: string;
      /** The bound Google account; data saved for another account is not used. */
      readonly permissionId: string;
      readonly accountEmail: string | null;
      readonly grantedScopes: readonly string[];
    }
  | {
      readonly ok: false;
      readonly state: Exclude<GoogleDriveConnectionState, "connected">;
      readonly problem: GoogleDriveProblem | null;
    };

/** An access token in process memory, valid for one stored connection. */
interface CachedAccessToken {
  readonly connectedAt: number;
  readonly accessToken: string;
  readonly expiresAt: number;
}

/** The result of asking Drive with a stored connection. */
type VerificationResult = GoogleCallResult<GoogleDriveAccount>;

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function challengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function isReauthorizationProblem(
  problem: GoogleDriveProblem,
): problem is GoogleDriveReauthorizationReason {
  return REAUTHORIZATION_PROBLEMS.some((reason) => reason === problem);
}

function refreshBinding(connectedAt: number): string {
  return `google-drive:refresh:${connectedAt}`;
}

function attemptBinding(attemptId: string): string {
  return `google-drive:attempt:${attemptId}`;
}

/**
 * Connects the instance to one Google Drive account and proves the connection
 * with a real, read-only Drive request.
 *
 * @remarks
 * The sign-in uses Google's official authorization code flow with PKCE and a
 * one-time `state` bound to the administrator who started it; the callback
 * needs the same Pages session. The refresh token is stored encrypted with the
 * instance key; access tokens live in this process only and are renewed with
 * the refresh token, so a reload, a new Pages sign-in or a restart needs no
 * new Google sign-in. When Google refuses the stored access, the connection is
 * marked for a new sign-in instead of showing a success it cannot prove.
 */
export class GoogleDriveConnectionService {
  private readonly repository: GoogleDriveRepository;
  private readonly cipher: InstanceSecretCipher;
  private readonly runtime: GoogleDriveRuntime | null;
  private readonly missingSettings: readonly string[];
  private readonly now: () => number;
  private cachedToken: CachedAccessToken | null = null;
  private pendingRefresh: Promise<GoogleCallResult<CachedAccessToken>> | null =
    null;

  /**
   * Creates the connection service.
   *
   * @param dependencies - Storage, cipher, Google access and the clock.
   */
  public constructor(dependencies: GoogleDriveConnectionDependencies) {
    this.repository = dependencies.repository;
    this.cipher = dependencies.cipher;
    this.runtime = dependencies.runtime;
    this.missingSettings = dependencies.missingSettings;
    this.now = dependencies.now ?? Date.now;
  }

  /**
   * Starts a sign-in and builds the official Google sign-in link.
   *
   * @param input - The administrator and the public address of the instance.
   * @returns The link, or `null` without an OAuth client.
   */
  public async start(input: {
    readonly userId: string;
    readonly baseUrl: string;
  }): Promise<string | null> {
    const runtime = this.runtime;

    if (!runtime) {
      return null;
    }

    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    const createdAt = this.now();
    const id = randomUUID();
    const redirectUri = `${input.baseUrl}${GOOGLE_DRIVE_CALLBACK_PATH}`;

    await this.repository.insertAttempt({
      codeVerifierSecret: this.cipher.encrypt(attemptBinding(id), codeVerifier),
      createdAt,
      expiresAt: createdAt + ATTEMPT_LIFETIME_MS,
      id,
      redirectUri,
      stateHash: hashState(state),
      userId: input.userId,
    });

    return buildGoogleAuthorizationUrl({
      clientId: runtime.application.clientId,
      codeChallenge: challengeOf(codeVerifier),
      redirectUri,
      state,
    });
  }

  /**
   * Finishes a sign-in when Google sends the browser back.
   *
   * @param userId - The signed-in administrator; only the one who started may finish.
   * @param input - The query parameters of the callback.
   * @returns What the settings tell the administrator.
   */
  public async complete(
    userId: string,
    input: GoogleDriveCallbackInput,
  ): Promise<GoogleDriveCallbackOutcome> {
    const runtime = this.runtime;

    if (!runtime) {
      return "not_configured";
    }

    if (
      input.baseUrl === null ||
      !input.state ||
      input.state.length > MAXIMUM_STATE_LENGTH
    ) {
      return "invalid";
    }

    const stateHash = hashState(input.state);
    const attempt = await this.repository.claimAttempt({
      now: this.now(),
      stateHash,
      userId,
    });

    if (!attempt) {
      return this.explainRefusedState(stateHash);
    }

    // The attempt is spent either way. Only the origin it started on may finish it.
    if (
      attempt.redirectUri !== `${input.baseUrl}${GOOGLE_DRIVE_CALLBACK_PATH}`
    ) {
      return "invalid";
    }

    if (input.error !== null) {
      return "denied";
    }

    if (!input.code || input.code.length > MAXIMUM_CODE_LENGTH) {
      return "failed";
    }

    return this.connect(runtime, attempt, input.code);
  }

  /**
   * Tells where the connection stands, with a real Drive request when one is stored.
   *
   * @param origins - The allowed origins and the one of the request.
   * @returns The status; `connected` only after Drive answered just now.
   */
  public async getStatus(
    origins: GoogleDriveOrigins,
  ): Promise<GoogleDriveStatus> {
    const base = {
      accountEmail: null,
      canSignIn: origins.current !== null,
      missingSettings: this.missingSettings,
      problem: null,
      redirectUris: origins.allowed.map(
        (origin) => `${origin}${GOOGLE_DRIVE_CALLBACK_PATH}`,
      ),
    };

    if (!this.runtime) {
      return { ...base, state: "not_configured" };
    }

    const connection = await this.repository.findConnection();

    if (!connection) {
      return { ...base, state: "disconnected" };
    }

    const reason = connection.reauthorizationReason;

    if (reason !== null) {
      return { ...base, problem: reason, state: "reauthorization_required" };
    }

    const result = await this.verify(this.runtime, connection);

    if (result.ok) {
      return {
        ...base,
        accountEmail: result.value.emailAddress,
        state: "connected",
      };
    }

    return {
      ...base,
      problem: result.problem,
      state: isReauthorizationProblem(result.problem)
        ? "reauthorization_required"
        : "unavailable",
    };
  }

  /**
   * Provides the stored connection for a read-only Drive request of the server.
   *
   * @returns A current access token after Drive confirmed the bound account
   * just now, or why the connection is not usable.
   *
   * @remarks
   * Every call proves the binding with `about.get`, renews the access token
   * with the stored refresh token when needed and marks the connection for a
   * new sign-in when Google refuses it, exactly like {@link getStatus}. No
   * other way to a token exists, so no foreign or stale token is ever used.
   */
  public async access(): Promise<GoogleDriveAccess> {
    if (!this.runtime) {
      return { ok: false, problem: null, state: "not_configured" };
    }

    const connection = await this.repository.findConnection();

    if (!connection) {
      return { ok: false, problem: null, state: "disconnected" };
    }

    if (connection.reauthorizationReason !== null) {
      return {
        ok: false,
        problem: connection.reauthorizationReason,
        state: "reauthorization_required",
      };
    }

    const result = await this.verify(this.runtime, connection);
    const token = this.currentToken(connection);

    if (!result.ok || !token) {
      const problem = result.ok ? "google_unreachable" : result.problem;

      return {
        ok: false,
        problem,
        state: isReauthorizationProblem(problem)
          ? "reauthorization_required"
          : "unavailable",
      };
    }

    return {
      accessToken: token.accessToken,
      accountEmail: result.value.emailAddress,
      grantedScopes: connection.grantedScope.split(" ").filter(Boolean),
      ok: true,
      permissionId: connection.googlePermissionId,
    };
  }

  private async explainRefusedState(
    stateHash: string,
  ): Promise<GoogleDriveCallbackOutcome> {
    const known = await this.repository.findAttemptByStateHash(stateHash);

    if (known && known.consumedAt === null && known.expiresAt <= this.now()) {
      return "expired";
    }

    return "invalid";
  }

  private readVerifier(attempt: GoogleDriveSignInAttempt): string | null {
    try {
      return this.cipher.decrypt(
        attemptBinding(attempt.id),
        attempt.codeVerifierSecret,
      );
    } catch (caughtError: unknown) {
      logCaughtError(COMPONENT, caughtError);

      return null;
    }
  }

  private async connect(
    runtime: GoogleDriveRuntime,
    attempt: GoogleDriveSignInAttempt,
    code: string,
  ): Promise<GoogleDriveCallbackOutcome> {
    const codeVerifier = this.readVerifier(attempt);

    if (codeVerifier === null) {
      return "failed";
    }

    const exchange = await runtime.client.exchangeCode({
      code,
      codeVerifier,
      redirectUri: attempt.redirectUri,
    });

    if (!exchange.ok) {
      this.reportProblem("sign_in_refused", exchange.problem);

      return "failed";
    }

    const grant = exchange.value;

    if (!grant.grantedScopes.includes(GOOGLE_DRIVE_SCOPE)) {
      return "scope_missing";
    }

    if (grant.refreshToken === null) {
      this.reportProblem("sign_in_without_refresh_token", "access_revoked");

      return "failed";
    }

    // Only Drive itself proves which account the tokens belong to.
    const account = await runtime.client.readAccount(grant.accessToken);

    if (!account.ok) {
      this.reportProblem("sign_in_unverified", account.problem);

      return account.problem === "scope_missing" ? "scope_missing" : "failed";
    }

    const connectedAt = this.now();

    await this.repository.saveConnection({
      connectedAt,
      connectedByUserId: attempt.userId,
      googleEmail: account.value.emailAddress,
      googlePermissionId: account.value.permissionId,
      grantedScope: grant.grantedScopes.join(" "),
      refreshTokenSecret: this.cipher.encrypt(
        refreshBinding(connectedAt),
        grant.refreshToken,
      ),
    });
    this.cachedToken = {
      accessToken: grant.accessToken,
      connectedAt,
      expiresAt: grant.expiresAt,
    };
    logEvent({
      component: COMPONENT,
      event: "google_drive.connected",
      level: "info",
      message:
        "Google Drive was connected and confirmed by a read-only request.",
    });

    return "connected";
  }

  private async verify(
    runtime: GoogleDriveRuntime,
    connection: StoredGoogleDriveConnection,
  ): Promise<VerificationResult> {
    const result = await this.readWithToken(runtime, connection);

    if (
      result.ok &&
      result.value.permissionId !== connection.googlePermissionId
    ) {
      await this.markForSignIn(connection, "account_changed");

      return { ok: false, problem: "account_changed" };
    }

    if (!result.ok) {
      await this.handleFailure(connection, result.problem);

      return result;
    }

    await this.repository.recordVerification({
      connectedAt: connection.connectedAt,
      googleEmail: result.value.emailAddress,
      now: this.now(),
    });

    return result;
  }

  /**
   * Reads the account with the cached access token, and once more with a
   * renewed one when Drive refuses the cached token.
   */
  private async readWithToken(
    runtime: GoogleDriveRuntime,
    connection: StoredGoogleDriveConnection,
  ): Promise<VerificationResult> {
    const cached = this.currentToken(connection);

    if (cached) {
      const result = await runtime.client.readAccount(cached.accessToken);

      if (result.ok || result.problem !== "access_revoked") {
        return result;
      }

      this.cachedToken = null;
    }

    const renewed = await this.renew(runtime, connection);

    return renewed.ok
      ? runtime.client.readAccount(renewed.value.accessToken)
      : renewed;
  }

  private currentToken(
    connection: StoredGoogleDriveConnection,
  ): CachedAccessToken | null {
    const cached = this.cachedToken;

    if (
      !cached ||
      cached.connectedAt !== connection.connectedAt ||
      cached.expiresAt - RENEWAL_MARGIN_MS <= this.now()
    ) {
      return null;
    }

    return cached;
  }

  /** Renews the access token once for all concurrent requests. */
  private async renew(
    runtime: GoogleDriveRuntime,
    connection: StoredGoogleDriveConnection,
  ): Promise<GoogleCallResult<CachedAccessToken>> {
    this.pendingRefresh ??= this.refreshToken(runtime, connection).finally(
      () => {
        this.pendingRefresh = null;
      },
    );

    return this.pendingRefresh;
  }

  private async refreshToken(
    runtime: GoogleDriveRuntime,
    connection: StoredGoogleDriveConnection,
  ): Promise<GoogleCallResult<CachedAccessToken>> {
    const refreshToken = this.readRefreshToken(connection);

    if (refreshToken === null) {
      return { ok: false, problem: "secret_unavailable" };
    }

    const result = await runtime.client.refresh(refreshToken);

    if (!result.ok) {
      return result;
    }

    const grant = result.value;
    const isCurrent = await this.repository.recordRefresh({
      connectedAt: connection.connectedAt,
      now: this.now(),
      refreshTokenSecret:
        grant.refreshToken === null
          ? null
          : this.cipher.encrypt(
              refreshBinding(connection.connectedAt),
              grant.refreshToken,
            ),
    });
    const token = {
      accessToken: grant.accessToken,
      connectedAt: connection.connectedAt,
      expiresAt: grant.expiresAt,
    };

    if (isCurrent) {
      this.cachedToken = token;
    }

    logEvent({
      component: COMPONENT,
      event: "google_drive.access_token_renewed",
      level: "info",
      message:
        "The Google Drive access token was renewed with the stored refresh token.",
      // Only allowlisted keys survive the log redaction (`LogRedaction.ts`).
      metadata: {
        kind: grant.refreshToken === null ? "kept" : "rotated",
        durationMs: grant.expiresAt - this.now(),
      },
    });

    return { ok: true, value: token };
  }

  private readRefreshToken(
    connection: StoredGoogleDriveConnection,
  ): string | null {
    try {
      return this.cipher.decrypt(
        refreshBinding(connection.connectedAt),
        connection.refreshTokenSecret,
      );
    } catch (caughtError: unknown) {
      logCaughtError(COMPONENT, caughtError);

      return null;
    }
  }

  private async handleFailure(
    connection: StoredGoogleDriveConnection,
    problem: GoogleDriveProblem,
  ): Promise<void> {
    if (isReauthorizationProblem(problem)) {
      await this.markForSignIn(connection, problem);

      return;
    }

    this.reportProblem("verification_failed", problem);
  }

  private async markForSignIn(
    connection: StoredGoogleDriveConnection,
    reason: GoogleDriveReauthorizationReason,
  ): Promise<void> {
    this.cachedToken = null;
    await this.repository.requireReauthorization({
      connectedAt: connection.connectedAt,
      reason,
    });
    logEvent({
      component: COMPONENT,
      event: "google_drive.reauthorization_required",
      level: "warn",
      message:
        "Google refused the stored Drive access; a new sign-in is required.",
      metadata: { reason },
    });
  }

  private reportProblem(event: string, problem: GoogleDriveProblem): void {
    logEvent({
      component: COMPONENT,
      event: `google_drive.${event}`,
      level: "warn",
      message: "Google Drive did not confirm the request.",
      metadata: { reason: problem },
    });
  }
}

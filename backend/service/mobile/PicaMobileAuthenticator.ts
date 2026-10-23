import { TooManyLoginAttemptsError } from "@/backend/auth/LoginThrottle";

import type { AuthService } from "@/backend/auth/AuthService";
import type {
  PicaMobileAuthPayload,
  PicaMobileUserPayload,
} from "@/definition/PicaMobileProtocol";
import type { User } from "@/definition/User";

/** What the server knows about the peer that wants to authenticate. */
export interface PicaMobileClientOrigin {
  readonly clientAddress: string | null;
  readonly userAgent: string | null;
}

/** The outcome of an authentication attempt. */
export type PicaMobileAuthOutcome =
  | {
      readonly ok: true;
      readonly user: PicaMobileUserPayload;
      /** The session the connection stays bound to. */
      readonly sessionToken: string;
      /** Whether the attempt created the session, so the client has to keep it. */
      readonly isSessionIssued: boolean;
    }
  | {
      readonly ok: false;
      readonly reason:
        "invalidCredentials" | "passwordChangeRequired" | "tooManyAttempts";
      readonly retryAfterSeconds?: number;
    };

/** Turns the credentials of a connection into a Pages account. */
export interface PicaMobileAuthenticator {
  /** Checks credentials; rejects only when Pages cannot decide right now. */
  authenticate(
    credentials: PicaMobileAuthPayload,
    origin: PicaMobileClientOrigin,
  ): Promise<PicaMobileAuthOutcome>;
  /** Tells whether the session of an authenticated connection still holds. */
  isSessionActive(sessionToken: string): Promise<boolean>;
}

function describeUser(user: User): PicaMobileUserPayload {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
  };
}

/**
 * Authenticates Pica Mobile connections with the Pages accounts.
 *
 * @remarks
 * It adds no credential type of its own: a `password` attempt is a normal
 * Pages login, including its throttle and its session, and a `session`
 * attempt presents the token of such a session. An account that has to
 * replace its password first cannot connect, as it cannot use the web
 * interface either.
 */
export class PagesPicaMobileAuthenticator implements PicaMobileAuthenticator {
  private readonly resolveAuthService: () => Promise<AuthService>;

  /**
   * Creates the authenticator.
   *
   * @param resolveAuthService - Resolves the authentication service when a
   * connection needs it, so the listener works before the database does.
   */
  public constructor(resolveAuthService: () => Promise<AuthService>) {
    this.resolveAuthService = resolveAuthService;
  }

  /** Checks a session token or a username and password against Pages. */
  public async authenticate(
    credentials: PicaMobileAuthPayload,
    origin: PicaMobileClientOrigin,
  ): Promise<PicaMobileAuthOutcome> {
    const authService = await this.resolveAuthService();

    if (credentials.method === "session") {
      return this.resumeSession(authService, credentials.token);
    }

    try {
      const login = await authService.login(
        credentials.username,
        credentials.password,
        origin.userAgent,
        origin.clientAddress,
      );

      return login === null
        ? { ok: false, reason: "invalidCredentials" }
        : await this.acceptLogin(authService, login);
    } catch (error: unknown) {
      if (error instanceof TooManyLoginAttemptsError) {
        return {
          ok: false,
          reason: "tooManyAttempts",
          retryAfterSeconds: error.retryAfterSeconds,
        };
      }

      throw error;
    }
  }

  /** Tells whether the session still belongs to an account that may sign in. */
  public async isSessionActive(sessionToken: string): Promise<boolean> {
    const user = await (
      await this.resolveAuthService()
    ).getAuthenticatedUser(sessionToken);

    return user !== null && !user.mustChangePassword;
  }

  private async resumeSession(
    authService: AuthService,
    token: string,
  ): Promise<PicaMobileAuthOutcome> {
    const user = await authService.getAuthenticatedUser(token);

    if (user === null) {
      return { ok: false, reason: "invalidCredentials" };
    }

    if (user.mustChangePassword) {
      return { ok: false, reason: "passwordChangeRequired" };
    }

    return {
      ok: true,
      user: describeUser(user),
      sessionToken: token,
      isSessionIssued: false,
    };
  }

  private async acceptLogin(
    authService: AuthService,
    login: { readonly user: User; readonly sessionToken: string },
  ): Promise<PicaMobileAuthOutcome> {
    if (login.user.mustChangePassword) {
      // The login created a session; an account that cannot use it keeps none.
      await authService.logout(login.sessionToken);

      return { ok: false, reason: "passwordChangeRequired" };
    }

    return {
      ok: true,
      user: describeUser(login.user),
      sessionToken: login.sessionToken,
      isSessionIssued: true,
    };
  }
}

import { randomUUID } from "node:crypto";

import type { LoginThrottle } from "@/backend/auth/LoginThrottle";
import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type { SessionService } from "@/backend/auth/SessionService";
import type { UserService } from "@/backend/service/UserService";
import type { User } from "@/definition/User";

/** Result of a successful login. */
export interface LoginResult {
  readonly user: User;
  readonly sessionToken: string;
}

/** Possible outcomes of {@link AuthService.changePassword}. */
export type ChangePasswordResult = "success" | "invalidCurrent" | "unchanged";

/** Authenticates users and manages their login state. */
export class AuthService {
  private readonly userService: UserService;
  private readonly sessionService: SessionService;
  private readonly passwordHasher: PasswordHasher;
  private readonly loginThrottle: LoginThrottle;
  private decoyPasswordHash: Promise<string> | undefined;

  /**
   * Creates an authentication service.
   *
   * @param userService - User business-logic boundary.
   * @param sessionService - Session business-logic boundary.
   * @param passwordHasher - scrypt password hashing.
   * @param loginThrottle - Counter that slows down password guessing.
   */
  public constructor(
    userService: UserService,
    sessionService: SessionService,
    passwordHasher: PasswordHasher,
    loginThrottle: LoginThrottle,
  ) {
    this.userService = userService;
    this.sessionService = sessionService;
    this.passwordHasher = passwordHasher;
    this.loginThrottle = loginThrottle;
  }

  /**
   * Verifies credentials and starts a session.
   *
   * @param username - Username entered by the visitor.
   * @param password - Password entered by the visitor.
   * @param userAgent - Raw user agent of the browser signing in.
   * @param clientAddress - Address of the visitor, when known.
   * @returns The login result, or `null` when the credentials are invalid.
   * @throws {TooManyLoginAttemptsError} When too many attempts failed recently.
   *
   * @remarks
   * Unknown users and wrong passwords are reported identically so callers
   * cannot tell them apart, including by response time: an unknown user is
   * verified against a decoy hash, which costs as much as a real one.
   */
  public async login(
    username: string,
    password: string,
    userAgent?: string | null,
    clientAddress?: string | null,
  ): Promise<LoginResult | null> {
    this.loginThrottle.assertAllowed(username, clientAddress);

    const credentials =
      await this.userService.findCredentialsByUsername(username);
    const isPasswordValid = await this.passwordHasher.verify(
      credentials?.passwordHash ?? (await this.getDecoyPasswordHash()),
      password,
    );

    if (!credentials || !isPasswordValid || !credentials.user.isActive) {
      this.loginThrottle.recordFailure(username, clientAddress);

      return null;
    }

    this.loginThrottle.recordSuccess(username);

    const sessionToken = await this.sessionService.createSession(
      credentials.user.id,
      userAgent,
    );

    return { user: credentials.user, sessionToken };
  }

  /**
   * Replaces the password of a user after verifying the current one.
   *
   * @param username - Username of the authenticated user.
   * @param currentPassword - Password the user entered as their current one.
   * @param newPassword - New password to store as a hash.
   * @param sessionToken - Token of the browser that requested the change.
   * @returns The outcome of the change attempt.
   *
   * @remarks
   * Every other session of the user is revoked, so a session that was
   * opened with the old password cannot outlive it. The requesting
   * browser stays signed in.
   */
  public async changePassword(
    username: string,
    currentPassword: string,
    newPassword: string,
    sessionToken: string | null,
  ): Promise<ChangePasswordResult> {
    const credentials =
      await this.userService.findCredentialsByUsername(username);

    if (
      !credentials ||
      !(await this.passwordHasher.verify(
        credentials.passwordHash,
        currentPassword,
      ))
    ) {
      return "invalidCurrent";
    }

    if (currentPassword === newPassword) {
      return "unchanged";
    }

    const passwordHash = await this.passwordHasher.hash(newPassword);

    await this.userService.updatePasswordHash(
      credentials.user.id,
      passwordHash,
    );
    await this.sessionService.revokeOtherSessions(
      credentials.user.id,
      sessionToken,
    );

    return "success";
  }

  /**
   * Ends the session belonging to a token.
   *
   * @param sessionToken - Token sent by the browser.
   */
  public async logout(sessionToken: string | null): Promise<void> {
    await this.sessionService.revoke(sessionToken);
  }

  /**
   * Resolves the user behind a session token.
   *
   * @param sessionToken - Token sent by the browser.
   * @returns The authenticated user, or `null` when the session is invalid.
   */
  public async getAuthenticatedUser(
    sessionToken: string | null,
  ): Promise<User | null> {
    return this.sessionService.authenticate(sessionToken);
  }

  private getDecoyPasswordHash(): Promise<string> {
    this.decoyPasswordHash ??= this.passwordHasher
      .hash(randomUUID())
      .catch((error: unknown) => {
        // Do not keep a failed attempt, so the next login can try again.
        this.decoyPasswordHash = undefined;

        throw error;
      });

    return this.decoyPasswordHash;
  }
}

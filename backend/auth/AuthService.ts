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

  /**
   * Creates an authentication service.
   *
   * @param userService - User business-logic boundary.
   * @param sessionService - Session business-logic boundary.
   * @param passwordHasher - scrypt password hashing.
   */
  public constructor(
    userService: UserService,
    sessionService: SessionService,
    passwordHasher: PasswordHasher,
  ) {
    this.userService = userService;
    this.sessionService = sessionService;
    this.passwordHasher = passwordHasher;
  }

  /**
   * Verifies credentials and starts a session.
   *
   * @param username - Username entered by the visitor.
   * @param password - Password entered by the visitor.
   * @param userAgent - Raw user agent of the browser signing in.
   * @returns The login result, or `null` when the credentials are invalid.
   *
   * @remarks
   * Unknown users and wrong passwords are reported identically so callers
   * cannot tell them apart.
   */
  public async login(
    username: string,
    password: string,
    userAgent?: string | null,
  ): Promise<LoginResult | null> {
    const credentials =
      await this.userService.findCredentialsByUsername(username);

    if (!credentials) {
      return null;
    }

    const isPasswordValid = await this.passwordHasher.verify(
      credentials.passwordHash,
      password,
    );

    if (!isPasswordValid) {
      return null;
    }

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
   * @returns The outcome of the change attempt.
   *
   * @remarks
   * Existing sessions stay valid; the operation deliberately only replaces
   * the stored hash and never logs the user out of their current browser.
   */
  public async changePassword(
    username: string,
    currentPassword: string,
    newPassword: string,
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
}

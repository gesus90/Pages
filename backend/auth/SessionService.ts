import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import type { UserService } from "@/backend/service/UserService";
import type { User } from "@/definition/User";

const SESSION_TOKEN_BYTES = 32;

/** Number of days a login session stays valid. */
export const SESSION_LIFETIME_DAYS = 14;

/** Number of seconds a login session stays valid. */
export const SESSION_LIFETIME_SECONDS = SESSION_LIFETIME_DAYS * 24 * 60 * 60;

/** Handles creation, validation, and revocation of login sessions. */
export class SessionService {
  private readonly sessionRepository: SessionRepository;
  private readonly userService: UserService;

  /**
   * Creates a session service.
   *
   * @param sessionRepository - Session persistence boundary.
   * @param userService - User business-logic boundary.
   */
  public constructor(
    sessionRepository: SessionRepository,
    userService: UserService,
  ) {
    this.sessionRepository = sessionRepository;
    this.userService = userService;
  }

  /**
   * Starts a new session for a user.
   *
   * @param userId - Identifier of the authenticated user.
   * @returns The token that must be sent to the browser.
   *
   * @remarks
   * Only the hash of the token is stored, so the returned value is the single
   * copy of the secret and must never be persisted server-side.
   */
  public async createSession(userId: string): Promise<string> {
    const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");

    await this.sessionRepository.insert({
      id: randomUUID(),
      userId,
      tokenHash: this.hashToken(token),
      lifetimeDays: SESSION_LIFETIME_DAYS,
    });

    return token;
  }

  /**
   * Resolves the user behind a session token.
   *
   * @param token - Token sent by the browser.
   * @returns The authenticated user, or `null` for missing, unknown, or
   * expired sessions, or when the user has since been deactivated.
   */
  public async authenticate(token: string | null): Promise<User | null> {
    if (!token) {
      return null;
    }

    const tokenHash = this.hashToken(token);
    const userId =
      await this.sessionRepository.findUserIdByTokenHash(tokenHash);

    if (!userId) {
      return null;
    }

    const user = await this.userService.getById(userId);

    if (!user || !user.isActive) {
      return null;
    }

    await this.sessionRepository.markUsed(tokenHash);

    return user;
  }

  /**
   * Invalidates a session so its token stops working.
   *
   * @param token - Token sent by the browser.
   */
  public async revoke(token: string | null): Promise<void> {
    if (!token) {
      return;
    }

    await this.sessionRepository.deleteByTokenHash(this.hashToken(token));
  }

  /** Removes sessions that have already expired. */
  public async removeExpiredSessions(): Promise<void> {
    await this.sessionRepository.deleteExpired();
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}

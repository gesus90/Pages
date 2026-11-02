import { createHash, randomBytes, randomUUID } from "node:crypto";

import { LRUCache } from "lru-cache";

import { parseUserAgent } from "@/backend/auth/UserAgent";
import { logCaughtError } from "@/backend/logging/Logger";

import type { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import type { UserService } from "@/backend/service/UserService";
import type { User } from "@/definition/User";
import type { SessionSummary } from "@/definition/Session";

const SESSION_TOKEN_BYTES = 32;

/** Number of days a login session stays valid. */
export const SESSION_LIFETIME_DAYS = 14;

/** Number of seconds a login session stays valid. */
export const SESSION_LIFETIME_SECONDS = SESSION_LIFETIME_DAYS * 24 * 60 * 60;

/** The repository records a session use at most once a minute. */
const SESSION_TOUCH_INTERVAL_MS = 60_000;

/** Sessions whose last recorded use the server remembers. */
const MAXIMUM_REMEMBERED_TOUCHES = 10_000;

/** Handles creation, validation, and revocation of login sessions. */
export class SessionService {
  private readonly sessionRepository: SessionRepository;
  private readonly userService: UserService;
  /** When each token hash was last sent to the repository as used. */
  private readonly touches = new LRUCache<string, number>({
    max: MAXIMUM_REMEMBERED_TOUCHES,
  });

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
   * @param userAgent - Raw user agent of the browser starting the session.
   * @returns The token that must be sent to the browser.
   *
   * @remarks
   * Only the hash of the token is stored, so the returned value is the single
   * copy of the secret and must never be persisted server-side.
   */
  public async createSession(
    userId: string,
    userAgent?: string | null,
  ): Promise<string> {
    const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");

    await this.sessionRepository.insert({
      id: randomUUID(),
      userId,
      tokenHash: this.hashToken(token),
      lifetimeDays: SESSION_LIFETIME_DAYS,
      userAgent,
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

    this.touch(tokenHash);

    return user;
  }

  /**
   * Resolves the identifier of the session behind a token.
   *
   * @param token - Token sent by the client.
   * @returns The session identifier, which is no secret, or `null` for an
   * unknown or expired session.
   *
   * @remarks
   * A long-lived binding, such as a push registration, refers to the session
   * by this identifier so it never has to keep the token.
   */
  public async findSessionId(token: string): Promise<string | null> {
    return this.sessionRepository.findIdByTokenHash(this.hashToken(token));
  }

  /**
   * Returns the unexpired sessions of a user with device information.
   *
   * @param userId - Identifier of the session owner.
   * @param currentToken - Token sent by the requesting browser.
   * @returns Session summaries with the current session listed first.
   */
  public async getSessionSummaries(
    userId: string,
    currentToken: string | null,
  ): Promise<SessionSummary[]> {
    const storedSessions = await this.sessionRepository.listActiveByUserId(
      userId,
      this.hashTokenForLookup(currentToken),
    );

    return storedSessions.map((stored) => {
      const userAgentInfo = parseUserAgent(stored.userAgent);

      return {
        id: stored.id,
        browser: userAgentInfo.browser,
        operatingSystem: userAgentInfo.operatingSystem,
        createdAt: stored.createdAt,
        lastUsedAt: stored.lastUsedAt,
        isCurrent: stored.isCurrent,
      };
    });
  }

  /**
   * Invalidates one of a user's sessions.
   *
   * @param userId - Identifier of the session owner.
   * @param sessionId - Identifier of the session to revoke.
   * @param currentToken - Token sent by the requesting browser.
   * @returns Whether the session existed and was revoked.
   *
   * @remarks
   * The requesting browser's own session is never revoked so callers cannot
   * lock themselves out.
   */
  public async revokeSessionById(
    userId: string,
    sessionId: string,
    currentToken: string | null,
  ): Promise<boolean> {
    const tokenHash = await this.sessionRepository.findTokenHashByIdAndUserId(
      sessionId,
      userId,
    );

    if (!tokenHash || tokenHash === this.hashTokenForLookup(currentToken)) {
      return false;
    }

    await this.sessionRepository.deleteByIdAndUserId(sessionId, userId);

    return true;
  }

  /**
   * Invalidates every session of a user except the requesting browser's own.
   *
   * @param userId - Identifier of the session owner.
   * @param currentToken - Token sent by the requesting browser.
   */
  public async revokeOtherSessions(
    userId: string,
    currentToken: string | null,
  ): Promise<void> {
    await this.sessionRepository.deleteAllExceptTokenHash(
      userId,
      this.hashTokenForLookup(currentToken),
    );
  }

  /**
   * Invalidates every session of a user, including the current browser's.
   *
   * @param userId - Identifier of the session owner.
   */
  public async revokeAllSessions(userId: string): Promise<void> {
    await this.sessionRepository.deleteAllByUserId(userId);
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

  private hashTokenForLookup(token: string | null): string {
    return token ? this.hashToken(token) : "";
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  /**
   * Records the use of a session without making the request wait for it.
   *
   * @remarks
   * `last_used_at` is minute-precise bookkeeping, not an authorization
   * input, so a request never waits behind a long database write for it
   * (PAGE-197). The service sends it at most once a minute per session and
   * never queues a second one while one is still waiting.
   */
  private touch(tokenHash: string): void {
    const now = Date.now();
    const last = this.touches.get(tokenHash);
    if (last !== undefined && now - last < SESSION_TOUCH_INTERVAL_MS) return;
    this.touches.set(tokenHash, now);
    void this.sessionRepository.markUsed(tokenHash).catch((error: unknown) => {
      this.touches.delete(tokenHash);
      logCaughtError("SessionService", error);
    });
  }
}

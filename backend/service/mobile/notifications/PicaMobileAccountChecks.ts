import type { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import type { UserService } from "@/backend/service/UserService";

/** Decides whether a registration still belongs to an account that may use Pages. */
export interface PicaMobileAccountChecks {
  /**
   * Tells whether the session of a registration holds and its account may
   * still receive notifications.
   *
   * @param accountId - The account the registration is bound to.
   * @param sessionId - The session the registration is bound to.
   * @returns `false` once the session is revoked or expired, the account is
   * deactivated, or the account has to change its password first. Rejects only
   * when Pages cannot decide right now.
   */
  isBindingValid(accountId: string, sessionId: string): Promise<boolean>;
}

/** Checks registrations against the sessions and accounts of Pages. */
export class PagesPicaMobileAccountChecks implements PicaMobileAccountChecks {
  private readonly sessions: Pick<SessionRepository, "isActive">;
  private readonly users: Pick<UserService, "getById">;

  /**
   * Creates the checks.
   *
   * @param sessions - Reads whether a session still exists.
   * @param users - Reads the current state of an account.
   */
  public constructor(
    sessions: Pick<SessionRepository, "isActive">,
    users: Pick<UserService, "getById">,
  ) {
    this.sessions = sessions;
    this.users = users;
  }

  /** Checks the session first, then the account. */
  public async isBindingValid(
    accountId: string,
    sessionId: string,
  ): Promise<boolean> {
    if (!(await this.sessions.isActive(sessionId, accountId))) {
      return false;
    }

    const user = await this.users.getById(accountId);

    return user !== null && user.isActive && !user.mustChangePassword;
  }
}

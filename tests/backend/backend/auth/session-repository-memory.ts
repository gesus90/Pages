import { SessionRepository } from "@/backend/database/repositories/SessionRepository";

import type { Database } from "@/backend/database/Database";
import type {
  NewSession,
  StoredActiveSession,
} from "@/backend/database/repositories/SessionRepository";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** A stored session with the clock values the SQL expressions would evaluate. */
interface MemorySession {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly userAgent: string | null;
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
  readonly expiresAt: number;
}

function unconnectedDatabase(): Database {
  // No connection exists: every method the service uses is overridden below.
  const unconnected: unknown = Object.create(null);

  return unconnected as Database;
}

/**
 * Session persistence held in memory.
 *
 * @remarks
 * Expiry follows `Date.now()`, so tests move time with fake timers. Like the
 * real insert, a session is only stored for an active user.
 */
export class MemorySessionRepository extends SessionRepository {
  public readonly sessions: MemorySession[] = [];
  private readonly isUserActive: (userId: string) => boolean;

  /** Binds the fake to the activity lookup of the user directory. */
  public constructor(isUserActive: (userId: string) => boolean) {
    super(unconnectedDatabase());
    this.isUserActive = isUserActive;
  }

  /** Stores a session that expires after its lifetime in days. */
  public override async insert(session: NewSession): Promise<void> {
    if (!this.isUserActive(session.userId)) {
      return;
    }

    this.sessions.push({
      id: session.id,
      userId: session.userId,
      tokenHash: session.tokenHash,
      userAgent: session.userAgent ?? null,
      createdAt: Date.now(),
      lastUsedAt: null,
      expiresAt: Date.now() + session.lifetimeDays * MILLISECONDS_PER_DAY,
    });
  }

  /** Finds the owner of an unexpired session. */
  public override async findUserIdByTokenHash(
    tokenHash: string,
  ): Promise<string | null> {
    return (
      this.active().find((session) => session.tokenHash === tokenHash)
        ?.userId ?? null
    );
  }

  /** Records the use of a session. */
  public override async markUsed(tokenHash: string): Promise<void> {
    this.replace(
      (session) => session.tokenHash === tokenHash,
      (session) => ({ ...session, lastUsedAt: Date.now() }),
    );
  }

  /** Lists unexpired sessions with the current one first, then newest use. */
  public override async listActiveByUserId(
    userId: string,
    currentTokenHash: string,
  ): Promise<
    ReadonlyArray<StoredActiveSession & { readonly isCurrent: boolean }>
  > {
    return this.active()
      .filter((session) => session.userId === userId)
      .map((session) => ({
        id: session.id,
        tokenHash: session.tokenHash,
        userAgent: session.userAgent,
        createdAt: new Date(session.createdAt).toISOString(),
        lastUsedAt: new Date(
          session.lastUsedAt ?? session.createdAt,
        ).toISOString(),
        isCurrent: session.tokenHash === currentTokenHash,
      }))
      .sort(
        (left, right) =>
          Number(right.isCurrent) - Number(left.isCurrent) ||
          right.lastUsedAt.localeCompare(left.lastUsedAt),
      );
  }

  /** Finds the token hash of one unexpired session of a user. */
  public override async findTokenHashByIdAndUserId(
    sessionId: string,
    userId: string,
  ): Promise<string | null> {
    return (
      this.active().find(
        (session) => session.id === sessionId && session.userId === userId,
      )?.tokenHash ?? null
    );
  }

  /** Removes one session of a user. */
  public override async deleteByIdAndUserId(
    sessionId: string,
    userId: string,
  ): Promise<void> {
    this.remove(
      (session) => session.id === sessionId && session.userId === userId,
    );
  }

  /** Removes every session of a user except the one with the given hash. */
  public override async deleteAllExceptTokenHash(
    userId: string,
    tokenHash: string,
  ): Promise<void> {
    this.remove(
      (session) => session.userId === userId && session.tokenHash !== tokenHash,
    );
  }

  /** Removes every session of a user. */
  public override async deleteAllByUserId(userId: string): Promise<void> {
    this.remove((session) => session.userId === userId);
  }

  /** Removes the session of a token hash. */
  public override async deleteByTokenHash(tokenHash: string): Promise<void> {
    this.remove((session) => session.tokenHash === tokenHash);
  }

  /** Removes every expired session. */
  public override async deleteExpired(): Promise<void> {
    this.remove((session) => session.expiresAt <= Date.now());
  }

  private active(): MemorySession[] {
    return this.sessions.filter((session) => session.expiresAt > Date.now());
  }

  private remove(matches: (session: MemorySession) => boolean): void {
    const kept = this.sessions.filter((session) => !matches(session));

    this.sessions.length = 0;
    this.sessions.push(...kept);
  }

  private replace(
    matches: (session: MemorySession) => boolean,
    update: (session: MemorySession) => MemorySession,
  ): void {
    this.sessions.forEach((session, index) => {
      if (matches(session)) {
        this.sessions[index] = update(session);
      }
    });
  }
}

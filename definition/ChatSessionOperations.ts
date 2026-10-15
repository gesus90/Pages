/** A conversation of one person; its five-word ID is the name shown in the panel. */
export interface ChatSession {
  readonly id: string;
  readonly createdAt: string;
  readonly lastMessageAt: string;
  /** Start of the first message, to recognize a session; empty for a new session. */
  readonly preview: string;
}

/** Explicit per-session outcome, including cleanup failures after a committed deletion. */
export interface ChatDeletionResult {
  readonly deleted: readonly string[];
  readonly failed: readonly {
    readonly sessionId: string;
    readonly error: string;
  }[];
  readonly cleanupFailed: readonly string[];
}

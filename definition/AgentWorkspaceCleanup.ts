/** Visible registration-removal obligations retain their original executor and immutable run. */
export interface AgentWorkspaceCleanup {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly runId: string;
  readonly ownerId: string;
  readonly blocker: string;
  readonly updatedAt: string;
  /** Older clients omit retry diagnostics. */
  readonly state?: "pending" | "needs_decision";
  readonly attempts?: number;
  readonly nextAttemptAt?: number;
  readonly retryStartedAt?: string;
  readonly eventRevision?: number;
  readonly stopRevision?: number;
}

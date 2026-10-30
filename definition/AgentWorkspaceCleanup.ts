/** Visible registration-removal obligations retain their original executor and immutable run. */
export interface AgentWorkspaceCleanup {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly runId: string;
  readonly ownerId: string;
  readonly blocker: string;
  readonly updatedAt: string;
}

/** Authorizes one person for one connection from current persisted facts. */
export interface ExecutionAuthorizer {
  requireUser(userId: string, connectionId: string): Promise<void>;
  /** Optional agent-account budget, called only for Claude plan steps. */
  requireClaudeBudget?(userId: string): Promise<void>;
}

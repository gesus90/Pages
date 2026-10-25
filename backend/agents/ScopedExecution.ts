/** Authorizes one person for one connection from current persisted facts. */
export interface ExecutionAuthorizer {
  requireUser(userId: string, connectionId: string): Promise<void>;
}

import { AsyncLocalStorage } from "node:async_hooks";

/** The verified actor of a business administration call, never a client-provided identity. */
const actors = new AsyncLocalStorage<string>();
/** Returns the actor whose current transaction is audited. */
export function managementAuditActor(): string | undefined {
  return actors.getStore();
}
/** Carries a verified account across nested services and database calls. */
export function withManagementAudit<Result>(
  actorId: string,
  work: () => Promise<Result>,
): Promise<Result> {
  return actors.run(actorId, work);
}

import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import {
  AdministrationError,
  AgentScopeInUseError,
} from "@/backend/error/AdministrationError";

import type {
  AuthorizationRepository,
  AuthorizationSnapshot,
} from "@/backend/database/repositories/AuthorizationRepository";
import type { AgentProfileTarget } from "@/definition/AgentProfile";
import type { AccountAccess, Department } from "@/definition/Authorization";

/** Resolves a target from the current aggregate snapshot. */
export function findAccount(
  snapshot: AuthorizationSnapshot,
  userId: string,
): AccountAccess {
  const account = snapshot.accounts.find(
    (candidate) => candidate.userId === userId,
  );
  if (!account) throw new AdministrationError("notFound");
  return account;
}

/** Requires a current active actor, never client-supplied authorization facts. */
export function activeAccount(
  snapshot: AuthorizationSnapshot,
  userId: string,
): AccountAccess {
  const account = findAccount(snapshot, userId);
  requireAdministration(account.isActive);
  return account;
}

/** Translates a failed management policy into the shared domain error. */
export function requireAdministration(allowed: boolean): void {
  if (!allowed) throw new AdministrationError("forbidden");
}

/** Validates bounded, nonempty names at the service boundary. */
export function validateAdministrationName(name: string): void {
  if (name.trim().length === 0 || name.length > 200)
    throw new AdministrationError("invalidInput");
}

/** Rejects conflicting catalog names without altering an existing record. */
export function requireUniqueAdministrationName(
  records: readonly Department[],
  input: Department,
): void {
  if (
    records.some(
      (record) =>
        record.id !== input.id &&
        record.name.toLowerCase() === input.name.trim().toLowerCase(),
    )
  ) {
    throw new AdministrationError("invalidInput");
  }
}

/**
 * Keeps a group or department while agents or connections use it, instead of silently withdrawing their scope or usage share.
 *
 * @remarks
 * Only administrators in the active admin mode manage agents and connections, so only they receive the names.
 *
 * @param repository - Authorization repository inside the deleting transaction.
 * @param actor - Current account that requested the deletion.
 * @param target - Group or department about to be deleted.
 * @throws {AgentScopeInUseError} When agents or connection scopes still reference the target.
 */
export async function requireNoAgentScope(
  repository: AuthorizationRepository,
  actor: AccountAccess,
  target: AgentProfileTarget,
): Promise<void> {
  const agents = await repository.agentProfiles().references(target);
  // Connection scopes name persons, groups and departments only.
  const connections =
    target.kind === "system"
      ? []
      : await repository
          .agentConnectionScopes()
          .references({ kind: target.kind, targetId: target.targetId });
  const references = [...agents, ...connections];
  if (references.length === 0) return;
  throw new AgentScopeInUseError(
    new UserPolicyService().isAdministrator(actor)
      ? references.map((reference) => reference.name)
      : [],
  );
}

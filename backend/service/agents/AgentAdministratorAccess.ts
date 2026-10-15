import { agentChannelPolicy } from "@/backend/auth/McpActorContext";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import { activeAccount } from "../AdministrationAccess";
import { agentTransactionScope } from "./AgentTransactionScope";

import type { AgentChannel } from "@/backend/auth/McpActorContext";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AuthorizationSnapshot } from "@/backend/database/repositories/AuthorizationRepository";
import type { User } from "@/definition/User";

/** An administrator whose rights were read inside the caller's transaction. */
export interface AgentAdministrator {
  readonly actor: User;
  readonly repository: AuthorizationRepository;
  readonly snapshot: AuthorizationSnapshot;
}

/**
 * Resolves the account behind a verified credential and requires the administrator boundary.
 *
 * @param database - The transaction every later read and write of the call shares.
 * @param userId - The owner of the credential.
 * @param channel - The agent surface; it alone decides whether the persisted role mode or the personal eligibility counts.
 * @returns The account and its freshly read authorization facts.
 * @throws {McpAuthorizationError} `invalid_token` for an inactive account or one that must change its password.
 * @throws {AgentOperationError} `FORBIDDEN` for anyone but a current administrator.
 */
export async function requireAgentAdministratorActor(
  database: DatabaseTransaction,
  userId: string,
  channel: AgentChannel,
): Promise<AgentAdministrator> {
  const repository = new AuthorizationRepository(
    agentTransactionScope(database),
  );
  const actor = await repository.users().findById(userId);
  if (!actor?.isActive || actor.mustChangePassword)
    throw new McpAuthorizationError("invalid_token", 401);
  const snapshot = await repository.snapshot();
  const account = activeAccount(snapshot, userId);
  const policy = agentChannelPolicy(channel);
  if (!new UserPolicyService(policy.actor).isAdministrator(account))
    throw new AgentOperationError("FORBIDDEN");
  return { actor, repository, snapshot };
}

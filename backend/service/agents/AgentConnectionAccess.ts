import { isInAgentConnectionScope } from "@/backend/auth/AgentConnectionScopePolicy";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";

/**
 * Decides from the stored scope whether a person may use a connection's models.
 *
 * @param connections - Connection persistence.
 * @param viewer - Current account facts and group memberships of the person.
 * @param connectionId - The connection that would run the model.
 * @returns Whether the person may use it now; a missing connection is never usable.
 */
export async function canUseAgentConnection(
  connections: AgentConnectionRepository,
  viewer: AgentViewer,
  connectionId: string,
): Promise<boolean> {
  const scope = await connections.scopes().find(connectionId);
  return scope !== null && isInAgentConnectionScope(scope, viewer);
}

interface AccessDependencies {
  readonly connections: AgentConnectionRepository;
  readonly authorization: AuthorizationRepository;
  readonly groups: UserGroupRepository;
}

/** Authorizes a person for a connection at the point where its model would run. */
export class AgentConnectionAccess {
  private readonly dependencies: AccessDependencies;

  public constructor(dependencies: AccessDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Requires that the person may use the connection, from current persisted facts.
   *
   * @param userId - The person on whose behalf the model runs.
   * @param connectionId - The connection that would run the model.
   * @throws {TextAssistantError} `accessDenied` for an unknown or inactive
   * account and for a connection whose scope excludes the person.
   *
   * @remarks
   * Reads account, group memberships and scope anew, so a changed membership or
   * scope applies to the next model call, whatever selection the caller holds.
   */
  public async requireUser(
    userId: string,
    connectionId: string,
  ): Promise<void> {
    const { connections, authorization, groups } = this.dependencies;
    const [snapshot, groupIds] = await Promise.all([
      authorization.snapshot(),
      groups.findIdsByMember(userId),
    ]);
    const actor = snapshot.accounts.find((entry) => entry.userId === userId);
    if (
      !actor ||
      !(await canUseAgentConnection(
        connections,
        { actor, groupIds },
        connectionId,
      ))
    )
      throw new TextAssistantError("accessDenied");
  }
}

import { isInAgentConnectionScope } from "@/backend/auth/AgentConnectionScopePolicy";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AgentProviderId } from "@/definition/AgentConnection";

interface QuotaConnectionAccessDependencies {
  readonly connections: Pick<
    AgentConnectionRepository,
    "list" | "find" | "scopes"
  >;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
}

/**
 * Decides which connections of a provider a person may see a quota card of.
 * @remarks
 * A card is visible exactly where the connection's usage scope admits the
 * person, read anew with every call: an active account, and for a restricted
 * scope a named person, group or department membership. Administrators get no
 * exception, because managing a connection is not using it. Only active
 * connections of the asked provider have cards.
 */
export class QuotaConnectionAccess {
  private readonly dependencies: QuotaConnectionAccessDependencies;

  public constructor(dependencies: QuotaConnectionAccessDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * The connections of a provider a person may use right now.
   * @param userId - The person.
   * @param provider - The provider of the connections.
   * @param connectionId - Limits the answer to this connection.
   * @returns The connections in the order of the repository; none for an
   * unknown or inactive account.
   */
  public async usableFor(
    userId: string,
    provider: AgentProviderId,
    connectionId?: string,
  ): Promise<AgentConnectionRecord[]> {
    const viewer = await this.viewer(userId);
    if (!viewer) return [];
    const stored = await this.storedConnections(connectionId);
    const candidates = stored.filter(
      (connection) => connection.provider === provider && connection.isActive,
    );
    return this.usableConnections(candidates, viewer);
  }

  private async storedConnections(
    connectionId?: string,
  ): Promise<readonly AgentConnectionRecord[]> {
    const { connections } = this.dependencies;
    if (connectionId === undefined) return connections.list();
    const connection = await connections.find(connectionId);
    return connection ? [connection] : [];
  }

  private async viewer(userId: string): Promise<AgentViewer | null> {
    const { authorization, groups } = this.dependencies;
    const [snapshot, groupIds] = await Promise.all([
      authorization.snapshot(),
      groups.findIdsByMember(userId),
    ]);
    const actor = snapshot.accounts.find((entry) => entry.userId === userId);
    return actor ? { actor, groupIds } : null;
  }

  private async usableConnections(
    candidates: readonly AgentConnectionRecord[],
    viewer: AgentViewer,
  ): Promise<AgentConnectionRecord[]> {
    const scopes = this.dependencies.connections.scopes();
    const usable: AgentConnectionRecord[] = [];
    for (const connection of candidates) {
      const scope = await scopes.find(connection.id);
      if (scope && isInAgentConnectionScope(scope, viewer))
        usable.push(connection);
    }
    return usable;
  }
}

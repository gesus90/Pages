import { isInAgentConnectionScope } from "@/backend/auth/AgentConnectionScopePolicy";
import { AgentError } from "@/backend/error/AgentErrors";
import { visibleClaudeQuotaWindows } from "@/definition/ClaudeQuota";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { ClaudeQuotaRecord } from "@/backend/database/repositories/agent/ClaudeQuotaRepository";
import type {
  ClaudeQuotaAccount,
  ClaudeQuotaSnapshot,
} from "@/definition/ClaudeQuota";
import type { ClaudeQuotaProbe } from "./ClaudeQuotaProbe";

interface ClaudeQuotaDependencies {
  readonly connections: AgentConnectionRepository;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
  /** Asks Claude anew; without it the cards show the stored figures. */
  readonly probe?: Pick<ClaudeQuotaProbe, "refresh">;
  readonly clock?: () => Date;
}

const EMPTY_RECORD: ClaudeQuotaRecord = { plan: null, windows: [] };

/**
 * Answers the quota page: one card per Claude connection a person may use.
 * @remarks
 * A card is visible exactly where the connection's usage scope admits the
 * person, read anew with every query: an active account, and for a
 * restricted scope a named person, group or department membership.
 * Administrators get no exception, because managing a connection is not
 * using it. Only active Claude Code connections have cards. Every query asks
 * Claude for the current usage of exactly these connections, stores it and
 * answers from the stored figures, so a connection Claude cannot be asked
 * about right now keeps its last figures.
 */
export class ClaudeQuotaService {
  private readonly dependencies: ClaudeQuotaDependencies;

  public constructor(dependencies: ClaudeQuotaDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Reads the cards of a person.
   * @param userId - The person reading the page.
   * @returns The cards in the order of the connection names; an unknown or
   * inactive account sees none.
   * @throws {AgentError} The failure of the usage query when every queried
   * connection failed, so the page keeps its last figures and reports the
   * failure.
   */
  public async listForUser(userId: string): Promise<ClaudeQuotaSnapshot> {
    const now = (this.dependencies.clock ?? (() => new Date()))();
    const viewer = await this.viewer(userId);
    const readAt = now.toISOString();
    if (!viewer) return { accounts: [], readAt };
    const { connections } = this.dependencies;
    const candidates = (await connections.list()).filter(
      (connection) =>
        connection.provider === "claude_code" && connection.isActive,
    );
    const usable = await this.usableConnections(candidates, viewer);
    if (usable.length === 0) return { accounts: [], readAt };
    await this.refresh(usable);
    const records = await connections.quotas().list();
    const accounts = usable
      .map((connection) =>
        this.account(connection, records.get(connection.id), now),
      )
      .sort((first, second) => first.name.localeCompare(second.name));
    return { accounts, readAt };
  }

  /**
   * Queries one connection after the other, so a page never starts a burst
   * of CLIs; the query fails only when no connection could be read.
   */
  private async refresh(
    connections: readonly AgentConnectionRecord[],
  ): Promise<void> {
    const { probe } = this.dependencies;
    if (!probe) return;
    let hasRead = false;
    let failure: AgentError | null = null;
    for (const connection of connections) {
      const outcome = await probe.refresh(connection);
      if (outcome.status === "read") hasRead = true;
      if (outcome.status === "failed")
        failure ??= new AgentError(outcome.errorCode);
    }
    if (failure && !hasRead) throw failure;
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

  private account(
    connection: AgentConnectionRecord,
    record: ClaudeQuotaRecord | undefined,
    now: Date,
  ): ClaudeQuotaAccount {
    const { plan, windows } = record ?? EMPTY_RECORD;
    return {
      connectionId: connection.id,
      name: connection.name,
      plan,
      windows: visibleClaudeQuotaWindows(windows, now),
    };
  }
}

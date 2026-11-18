import { isInAgentConnectionScope } from "@/backend/auth/AgentConnectionScopePolicy";
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
  ClaudeQuotaStatus,
  ClaudeQuotaWindow,
} from "@/definition/ClaudeQuota";
import type {
  ClaudeQuotaProbe,
  ClaudeQuotaProbeOutcome,
} from "./ClaudeQuotaProbe";

interface ClaudeQuotaDependencies {
  readonly connections: AgentConnectionRepository;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
  /** Asks Claude anew for the usage of each connection. */
  readonly probe: Pick<ClaudeQuotaProbe, "refresh">;
  readonly clock?: () => Date;
}

const EMPTY_RECORD: ClaudeQuotaRecord = {
  plan: null,
  windows: [],
  reportedAt: null,
};

/**
 * What the status line of a card says about the last query.
 * @param outcome - The outcome of this query of the connection.
 * @param record - The figures stored after it.
 * @param windows - The stored windows still ahead of their reset.
 * @remarks
 * After an answer the time is that of the answer, which the probe stored as
 * the newest reading; at least one window with a value means "reported",
 * none means "no windows", never a failure.
 */
function quotaStatus(
  outcome: ClaudeQuotaProbeOutcome,
  record: ClaudeQuotaRecord,
  windows: readonly ClaudeQuotaWindow[],
): ClaudeQuotaStatus {
  if (outcome.status === "busy") return { kind: "skipped" };
  if (outcome.status === "signed_out") return { kind: "signed_out" };
  if (outcome.status === "failed" || record.reportedAt === null)
    return { kind: "failed", lastSuccessAt: record.reportedAt };
  return windows.length > 0
    ? { kind: "reported", at: record.reportedAt }
    : { kind: "no_windows", at: record.reportedAt };
}

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
 * about right now keeps its last figures. Each card carries the outcome of
 * its own query: reported, no windows, failed, skipped while a session holds
 * the sign-in, or signed out.
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
   * inactive account sees none. A failed usage query is the status of its
   * card, not a failure of the answer.
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
    const outcomes = await this.refresh(usable);
    const records = await connections.quotas().list();
    const accounts = usable
      .map((connection) =>
        this.account(
          connection,
          {
            outcome: outcomes.get(connection.id) ?? {
              status: "failed",
              errorCode: "cli_check_failed",
            },
            record: records.get(connection.id) ?? EMPTY_RECORD,
          },
          now,
        ),
      )
      .sort((first, second) => first.name.localeCompare(second.name));
    return { accounts, readAt };
  }

  /**
   * Queries one connection after the other, so a page never starts a burst
   * of CLIs.
   * @returns The outcome of each connection's query by connection id.
   */
  private async refresh(
    connections: readonly AgentConnectionRecord[],
  ): Promise<ReadonlyMap<string, ClaudeQuotaProbeOutcome>> {
    const outcomes = new Map<string, ClaudeQuotaProbeOutcome>();
    for (const connection of connections)
      outcomes.set(
        connection.id,
        await this.dependencies.probe.refresh(connection),
      );
    return outcomes;
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

  /**
   * The card of a connection.
   * @remarks
   * A connection without a sign-in has no plan Claude could vouch for, so its
   * card shows neither a plan nor windows.
   */
  private account(
    connection: AgentConnectionRecord,
    query: {
      readonly outcome: ClaudeQuotaProbeOutcome;
      readonly record: ClaudeQuotaRecord;
    },
    now: Date,
  ): ClaudeQuotaAccount {
    const { outcome, record } = query;
    const windows = visibleClaudeQuotaWindows(record.windows, now);
    const status = quotaStatus(outcome, record, windows);
    const isSignedOut = status.kind === "signed_out";
    return {
      connectionId: connection.id,
      name: connection.name,
      plan: isSignedOut ? null : record.plan,
      windows: isSignedOut ? [] : windows,
      status,
    };
  }
}
